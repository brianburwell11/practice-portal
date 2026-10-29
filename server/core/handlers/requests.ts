/**
 * Requests to join a Members-only band, from signed-in people who aren't in
 * it. The band's Owner is emailed; an Owner or Manager (`member.invite`)
 * approves — the requester joins as a Member — or declines, and the requester
 * is emailed either way. Every decision is audited.
 *
 * Bands are found by route (`/api/access/:slug`) on the requester's side: the
 * page they landed on knows only its address, since a Members-only band is
 * missing from their band list.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId, requireCan, roleIn, type BandRef } from '../auth/can';
import { emailLinkOrigin, emailText, escapeHtml, htmlEmail, sendEmailLater } from '../email';
import { HttpError, json } from '../http';
import { r2PublicUrl } from '../r2';
import type { Actor, CoreRequest, CoreResponse } from '../types';
import { audit } from './members';

/** A request's message, which ends up in the Owner's email: short, like a note. */
const MESSAGE_MAX = 100;
/** After a decline, how long before the same person may ask again. */
const RETRY_AFTER_DECLINE_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many requests per user per hour, across all bands. */
const REQUEST_RATE = { max: 5, windowMs: 60 * 60 * 1000 };
const recentRequests = new Map<string, number[]>();

function rateLimitRequests(userId: string): void {
  const now = Date.now();
  const recent = (recentRequests.get(userId) ?? []).filter((t) => now - t < REQUEST_RATE.windowMs);
  if (recent.length >= REQUEST_RATE.max) throw new HttpError(429, 'Too many requests in the last hour — try again later');
  recent.push(now);
  recentRequests.set(userId, recent);
}

const requireActor = (req: CoreRequest): Actor => {
  if (!req.actor) throw new HttpError(401, 'Sign in required');
  return req.actor;
};

type BandRow = typeof schema.band.$inferSelect;

async function bandBySlug(raw: string): Promise<BandRow> {
  let slug: string;
  try { slug = decodeURIComponent(raw); } catch { throw new HttpError(404, 'Band not found'); }
  const [band] = await db().select().from(schema.band)
    .where(and(eq(schema.band.slug, slug), isNull(schema.band.deletedAt)));
  if (!band) throw new HttpError(404, 'Band not found');
  return band;
}

const refOf = (b: BandRow): BandRef => ({
  id: b.id, legacyId: b.legacyId, slug: b.slug, name: b.name, ownerUserId: b.ownerUserId, visibility: b.visibility,
});

function logoUrl(b: BandRow): string | null {
  const base = r2PublicUrl();
  return b.logoKey && base ? `${base.replace(/\/$/, '')}/${b.logoKey}` : null;
}

async function latestRequest(bandId: string, userId: string) {
  const [row] = await db().select().from(schema.accessRequest)
    .where(and(eq(schema.accessRequest.bandId, bandId), eq(schema.accessRequest.userId, userId)))
    .orderBy(desc(schema.accessRequest.createdAt)).limit(1);
  return row ?? null;
}

/** Where the requester stands, and whether they may ask now. */
async function standing(band: BandRow, actor: Actor) {
  const member = (await roleIn(actor.userId, refOf(band))) !== null;
  const request = await latestRequest(band.id, actor.userId);
  const retryAt = request?.status === 'declined' && request.decidedAt
    ? new Date(request.decidedAt.getTime() + RETRY_AFTER_DECLINE_MS)
    : null;
  const canRequest = band.visibility === 'private' && !member && request?.status !== 'pending'
    && !(retryAt && retryAt.getTime() > Date.now());
  return { member, request, canRequest, retryAt: retryAt && retryAt.getTime() > Date.now() ? retryAt : null };
}

/**
 * `GET /api/access/:slug` — the band's name and logo, and, for a signed-in
 * caller, where they stand with it. Public: it reveals that a Members-only
 * band exists at this address, which is the point — whoever found it may
 * sign in, or ask to join.
 */
export async function getAccess(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandBySlug(req.params.slug);
  const info = { id: band.legacyId, slug: band.slug, name: band.name, logo: logoUrl(band), visibility: band.visibility };
  if (!req.actor) return json({ band: info, member: false, request: null, canRequest: false, retryAt: null });
  const { member, request, canRequest, retryAt } = await standing(band, req.actor);
  return json({
    band: info,
    member,
    request: request && { status: request.status, createdAt: request.createdAt, decidedAt: request.decidedAt },
    canRequest,
    retryAt,
  });
}

/** `POST /api/access/:slug` `{ message? }` — ask to join; emails the band's Owner. */
export async function requestAccess(req: CoreRequest): Promise<CoreResponse> {
  const actor = requireActor(req);
  const band = await bandBySlug(req.params.slug);
  const raw = (req.body as { message?: unknown } | undefined)?.message;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new HttpError(400, 'message must be text');
  const message = (raw ?? '').trim() || null;
  if (message && message.length > MESSAGE_MAX) throw new HttpError(400, `Keep the message to ${MESSAGE_MAX} characters`);

  const { member, request, canRequest, retryAt } = await standing(band, actor);
  if (band.visibility !== 'private') throw new HttpError(400, 'This band is Public — no need to ask');
  if (member) throw new HttpError(400, 'You’re already in this band');
  if (request?.status === 'pending') throw new HttpError(409, 'You’ve already asked — the band hasn’t answered yet');
  if (!canRequest) throw new HttpError(429, `You can ask again after ${retryAt?.toDateString() ?? 'a while'}`);
  rateLimitRequests(actor.userId);

  let id: string;
  try {
    id = await db().transaction(async (tx) => {
      const [row] = await tx.insert(schema.accessRequest)
        .values({ bandId: band.id, userId: actor.userId, message }).returning({ id: schema.accessRequest.id });
      await audit(tx, refOf(band), actor, 'access_request.create', row.id);
      return row.id;
    });
  } catch (err) {
    if (/access_request_one_pending/.test(String((err as { cause?: unknown })?.cause ?? err))) {
      throw new HttpError(409, 'You’ve already asked — the band hasn’t answered yet');
    }
    throw err;
  }

  const [requester] = await db().select({ name: schema.appUser.displayName, email: schema.appUser.email })
    .from(schema.appUser).where(eq(schema.appUser.id, actor.userId));
  const [owner] = await db().select({ email: schema.appUser.email })
    .from(schema.appUser).where(eq(schema.appUser.id, band.ownerUserId));
  // Names and the message are user input: no links, at most 100 characters (emailText).
  const name = emailText(requester.name);
  const who = name ? `${name} (${requester.email})` : requester.email;
  const bandName = emailText(band.name, 'your band');
  const note = emailText(message);
  const url = `${emailLinkOrigin(req.origin)}/${encodeURIComponent(band.slug)}?requests=1`;
  const emailed = sendEmailLater({
    to: owner.email,
    replyTo: requester.email,
    subject: `${name || requester.email} asked to join ${bandName}`,
    text: [
      `${who} asked to join ${bandName} on Practice Portal.`,
      ...(note ? [`Their message:\n\n${note}`] : []),
      `Approve or decline in Members & Sharing: ${url}`,
      'Reply to this email to write back to them.',
    ].join('\n\n'),
    html: htmlEmail([
      `<strong>${escapeHtml(who)}</strong> asked to join <strong>${escapeHtml(bandName)}</strong> on Practice Portal.`,
      ...(note ? [`Their message:<br><span style="white-space:pre-wrap">${escapeHtml(note)}</span>`] : []),
      'Reply to this email to write back to them.',
    ], { label: 'Approve or decline', url }),
  });
  return json({ ok: true, id, emailed });
}

/** `GET /api/bands/:bandId/access-requests` — pending requests, oldest first. */
export async function listAccessRequests(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  await requireCan(req.actor, 'member.invite', band);
  const requests = await db().select({
    id: schema.accessRequest.id,
    message: schema.accessRequest.message,
    createdAt: schema.accessRequest.createdAt,
    userId: schema.appUser.id,
    email: schema.appUser.email,
    name: schema.appUser.displayName,
    avatarUrl: schema.appUser.avatarUrl,
  }).from(schema.accessRequest)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.accessRequest.userId))
    .where(and(eq(schema.accessRequest.bandId, band.id), eq(schema.accessRequest.status, 'pending')))
    .orderBy(schema.accessRequest.createdAt);
  return json({ requests });
}

/**
 * `POST /api/bands/:bandId/access-requests/:requestId/(approve|decline)`.
 * Approving adds the requester as a Member (an existing role is left alone).
 */
export async function decideAccessRequest(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  const approve = req.params.decision === 'approve';

  const requester = await db().transaction(async (tx) => {
    const [request] = await tx.select().from(schema.accessRequest).where(and(
      eq(schema.accessRequest.id, req.params.requestId),
      eq(schema.accessRequest.bandId, band.id),
    )).for('update');
    if (!request) throw new HttpError(404, 'No such request');
    if (request.status !== 'pending') throw new HttpError(409, `That request was already ${request.status}`);

    if (approve && request.userId !== band.ownerUserId) {
      await tx.insert(schema.membership).values({ userId: request.userId, bandId: band.id, role: 'member' })
        .onConflictDoNothing();
    }
    await tx.update(schema.accessRequest)
      .set({ status: approve ? 'approved' : 'declined', decidedAt: new Date(), decidedBy: actor.userId })
      .where(eq(schema.accessRequest.id, request.id));
    await audit(tx, band, actor, approve ? 'access_request.approve' : 'access_request.decline', request.id,
      { user: request.userId });
    const [user] = await tx.select({ email: schema.appUser.email }).from(schema.appUser)
      .where(eq(schema.appUser.id, request.userId));
    return user;
  });

  const url = `${emailLinkOrigin(req.origin)}/${encodeURIComponent(band.slug)}`;
  const bandName = emailText(band.name, 'the band');
  const emailed = sendEmailLater(approve ? {
    to: requester.email,
    subject: `You’re in: ${bandName}`,
    text: `Your request to join ${bandName} on Practice Portal was approved. You’re a Member now.\n\nOpen the band: ${url}`,
    html: htmlEmail([
      `Your request to join <strong>${escapeHtml(bandName)}</strong> on Practice Portal was approved. You’re a Member now.`,
    ], { label: `Open ${bandName}`, url }),
  } : {
    to: requester.email,
    subject: `Your request to join ${bandName}`,
    text: `Your request to join ${bandName} on Practice Portal wasn’t approved. If you think that’s a mistake, ask someone in the band directly.`,
    html: htmlEmail([
      `Your request to join <strong>${escapeHtml(bandName)}</strong> on Practice Portal wasn’t approved.`,
      'If you think that’s a mistake, ask someone in the band directly.',
    ]),
  });
  return json({ ok: true, emailed });
}
