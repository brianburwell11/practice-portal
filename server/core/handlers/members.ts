/**
 * Invites, the roster, and ownership transfer (Phase 5).
 *
 * Bands are addressed by legacy id, like every other route. Permission checks
 * go through `can()` against the role tables; every change that grants or
 * removes access writes an `audit_log` row in the same transaction.
 *
 * Rules beyond the capability check:
 *   - nobody grants a role above their own (a Manager can make Managers,
 *     not Owners);
 *   - the Owner is never edited or removed through the roster — ownership
 *     moves only by transfer;
 *   - anyone can leave a band they're in, except its Owner.
 */
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId, effectiveRole, isAssignable, requireCan, roleIn, roleRank, type BandRef } from '../auth/can';
import { hashToken, newToken } from '../auth/sessions';
import { emailLinkOrigin, emailText, escapeHtml, htmlEmail, isBlocked, sendEmailLater, type Email } from '../email';
import { HttpError, json, ok } from '../http';
import type { Actor, CoreRequest, CoreResponse } from '../types';
import { auditActorKind } from '../store';
import type { Db } from '../documents';

export const INVITE_TTL_DAYS = 7;

/**
 * At most this many invite emails per band in any 7 days. Past it, invites
 * are still made, and their link is shown to share another way.
 */
export const INVITE_EMAILS_PER_WEEK = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * At most this many invites and guest links, together, per user per hour —
 * links are cheap to mint and to spray.
 */
const INVITE_RATE = { max: 20, windowMs: 60 * 60 * 1000 };
const recentInvites = new Map<string, number[]>();

export function rateLimitInvites(userId: string): void {
  const now = Date.now();
  const recent = (recentInvites.get(userId) ?? []).filter((t) => now - t < INVITE_RATE.windowMs);
  if (recent.length >= INVITE_RATE.max) {
    throw new HttpError(429, 'Too many links in the last hour — try again later');
  }
  recent.push(now);
  recentInvites.set(userId, recent);
}

export type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export async function audit(tx: Tx, band: BandRef, actor: Actor, action: string, target: string, diff?: unknown): Promise<void> {
  await tx.insert(schema.auditLog).values({
    bandId: band.id, actorId: actor.userId, actorKind: await auditActorKind(tx as unknown as Db, actor, band.id),
    action, target, diff: diff ?? null,
  });
}

/** Refuse to grant a role more privileged than the granter's own. */
async function assertCanGrant(actor: Actor, band: BandRef, role: string): Promise<void> {
  if (!(await isAssignable(role))) throw new HttpError(400, `"${role}" can't be assigned`);
  const mine = await effectiveRole(actor, band);
  if (mine === null || (await roleRank(role)) < (await roleRank(mine))) {
    throw new HttpError(403, `You can't grant a role above your own`);
  }
}

// ------------------------------------------------------------------ roster

/** `GET /api/bands/:bandId/members` — members, roles, and pending invites. */
export async function listMembers(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);

  const user = {
    userId: schema.appUser.id,
    email: schema.appUser.email,
    name: schema.appUser.displayName,
    avatarUrl: schema.appUser.avatarUrl,
  };
  const [owner] = await db().select(user).from(schema.appUser).where(eq(schema.appUser.id, band.ownerUserId));
  const members = await db().select({ ...user, role: schema.membership.role, joinedAt: schema.membership.joinedAt })
    .from(schema.membership)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.membership.userId))
    .innerJoin(schema.role, eq(schema.role.key, schema.membership.role))
    .where(eq(schema.membership.bandId, band.id))
    .orderBy(schema.role.sortOrder, schema.appUser.email);
  const invites = await db().select({
    id: schema.invite.id,
    email: schema.invite.email,
    role: schema.invite.role,
    expiresAt: schema.invite.expiresAt,
    createdAt: schema.invite.createdAt,
  }).from(schema.invite).where(and(
    eq(schema.invite.bandId, band.id),
    isNull(schema.invite.acceptedAt),
    isNull(schema.invite.revokedAt),
    gt(schema.invite.expiresAt, new Date()),
  )).orderBy(desc(schema.invite.createdAt));

  return json({
    band: { visibility: band.visibility },
    you: { userId: actor.userId, role: await effectiveRole(actor, band) },
    members: [{ ...owner, role: 'owner', joinedAt: null }, ...members],
    invites,
  });
}

/** `PUT /api/bands/:bandId/members/:userId` `{ role }` */
export async function setMemberRole(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.role.set', band);
  const { role } = (req.body ?? {}) as { role?: string };
  if (!role) throw new HttpError(400, 'role is required');
  const targetId = req.params.userId;
  if (targetId === band.ownerUserId) throw new HttpError(400, 'The Owner changes only by transferring ownership');

  await assertCanGrant(actor, band, role);
  const current = await roleIn(targetId, band);
  if (current === null) throw new HttpError(404, 'Not a member of this band');
  // Nor can you demote someone who outranks you.
  if ((await roleRank(current)) < (await roleRank((await effectiveRole(actor, band))!))) {
    throw new HttpError(403, `You can't change the role of someone above you`);
  }

  await db().transaction(async (tx) => {
    await tx.update(schema.membership).set({ role })
      .where(and(eq(schema.membership.bandId, band.id), eq(schema.membership.userId, targetId)));
    await audit(tx, band, actor, 'member.role.set', targetId, { from: current, to: role });
  });
  return ok();
}

/** `DELETE /api/bands/:bandId/members/:userId` — remove someone, or leave. */
export async function removeMember(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  if (!req.actor) throw new HttpError(401, 'Sign in required');
  const targetId = req.params.userId;
  if (targetId === band.ownerUserId) {
    throw new HttpError(400, 'The Owner can’t be removed — transfer ownership first');
  }

  const leaving = targetId === req.actor.userId;
  const actor = leaving ? req.actor : await requireCan(req.actor, 'member.role.set', band);
  const current = await roleIn(targetId, band);
  if (current === null) throw new HttpError(404, 'Not a member of this band');
  if (!leaving && (await roleRank(current)) < (await roleRank((await effectiveRole(actor, band))!))) {
    throw new HttpError(403, `You can't remove someone above you`);
  }

  await db().transaction(async (tx) => {
    await tx.delete(schema.membership)
      .where(and(eq(schema.membership.bandId, band.id), eq(schema.membership.userId, targetId)));
    await audit(tx, band, actor, leaving ? 'member.leave' : 'member.remove', targetId, { role: current });
  });
  return ok();
}

/**
 * `POST /api/bands/:bandId/transfer` `{ userId }` — Owner only. The new Owner
 * must already be a member; the old Owner stays on as a Manager.
 */
export async function transferOwnership(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'band.transfer', band);
  const { userId: newOwner } = (req.body ?? {}) as { userId?: string };
  if (!newOwner) throw new HttpError(400, 'userId is required');
  if (newOwner === band.ownerUserId) throw new HttpError(400, 'They already own this band');
  if ((await roleIn(newOwner, band)) === null) throw new HttpError(400, 'Ownership can only go to a current member');

  await db().transaction(async (tx) => {
    // Owner lives in band.owner_user_id, never in membership.
    await tx.delete(schema.membership)
      .where(and(eq(schema.membership.bandId, band.id), eq(schema.membership.userId, newOwner)));
    await tx.update(schema.band).set({ ownerUserId: newOwner }).where(eq(schema.band.id, band.id));
    await tx.insert(schema.membership).values({ userId: band.ownerUserId, bandId: band.id, role: 'manager' });
    await audit(tx, band, actor, 'band.transfer', newOwner, { from: band.ownerUserId });
  });
  return ok();
}

// ----------------------------------------------------------------- invites

/**
 * `POST /api/bands/:bandId/invites` `{ role, email? }` — returns the link.
 * The token exists only in the response; Postgres keeps its hash.
 */
export async function createInvite(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  const { role, email } = (req.body ?? {}) as { role?: string; email?: string };
  if (!role) throw new HttpError(400, 'role is required');
  const lock = email?.trim() || null;
  if (lock && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lock)) throw new HttpError(400, 'That email address looks wrong');
  await assertCanGrant(actor, band, role);
  rateLimitInvites(actor.userId);

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  // An invite locked to an address is emailed there too, unless the address
  // opted out or the band has used its emails for the week.
  const blocked = lock ? await isBlocked(lock) : false;
  const { id, emailedAt, emailSkipped } = await db().transaction(async (tx) => {
    let skipped: 'blocked' | 'weekly-limit' | null = blocked ? 'blocked' : null;
    if (lock && !skipped) {
      // One invite at a time per band, so two at once can't both take the last email.
      await tx.execute(sql`select id from ${schema.band} where id = ${band.id} for update`);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.invite).where(and(
        eq(schema.invite.bandId, band.id),
        gt(schema.invite.emailedAt, new Date(Date.now() - WEEK_MS)),
      ));
      if (n >= INVITE_EMAILS_PER_WEEK) skipped = 'weekly-limit';
    }
    const sentAt = lock && !skipped ? new Date() : null;
    const [row] = await tx.insert(schema.invite).values({
      bandId: band.id, email: lock, role, tokenHash: hashToken(token), expiresAt, createdBy: actor.userId, emailedAt: sentAt,
    }).returning({ id: schema.invite.id });
    await audit(tx, band, actor, 'invite.create', row.id, { role, email: lock, emailed: !!sentAt });
    return { id: row.id, emailedAt: sentAt, emailSkipped: lock ? skipped : null };
  });
  const site = emailLinkOrigin(req.origin);
  const url = `${site}/invite/${token}`;
  // The link is always returned, so it can be sent another way if no email goes.
  const emailed = lock && emailedAt
    ? sendEmailLater(() => inviteEmail(lock, actor, band, role, url, `${site}/email/unsubscribe?token=${token}`))
    : false;
  return json({ id, url, role, email: lock, expiresAt, emailed, emailSkipped });
}

async function inviteEmail(to: string, actor: Actor, band: BandRef, role: string, url: string, unsubscribe: string): Promise<Email> {
  const [inviter] = await db().select({ name: schema.appUser.displayName, email: schema.appUser.email })
    .from(schema.appUser).where(eq(schema.appUser.id, actor.userId));
  // Names are user input: no links, at most 100 characters (emailText).
  const who = emailText(inviter?.name, inviter?.email ?? 'Someone');
  const bandName = emailText(band.name, 'a band');
  const as = role[0].toUpperCase() + role.slice(1);
  return {
    to,
    replyTo: inviter?.email,
    subject: `${who} invited you to ${bandName} on Practice Portal`,
    text: [
      `${who} invited you to join ${bandName} on Practice Portal, as ${as}.`,
      `Join here. Sign in with Google as ${to}: ${url}`,
      `The link works once and expires in ${INVITE_TTL_DAYS} days. Reply to this email to write back to ${who}.`,
      `Don’t want emails from Practice Portal? ${unsubscribe}`,
    ].join('\n\n'),
    html: htmlEmail([
      `<strong>${escapeHtml(who)}</strong> invited you to join <strong>${escapeHtml(bandName)}</strong> on Practice Portal, as ${escapeHtml(as)}.`,
      `Sign in with Google as ${escapeHtml(to)} to join. The link works once and expires in ${INVITE_TTL_DAYS} days.`,
      `Reply to this email to write back to ${escapeHtml(who)}.`,
    ], { label: `Join ${bandName}`, url }, { label: 'Don’t email me again', url: unsubscribe }),
    // One-click unsubscribe (RFC 8058): mail apps show their own button for it.
    headers: {
      'List-Unsubscribe': `<${unsubscribe.replace('/email/unsubscribe?', '/api/email/block?')}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** `DELETE /api/bands/:bandId/invites/:inviteId` */
export async function revokeInvite(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  await db().transaction(async (tx) => {
    const [row] = await tx.update(schema.invite).set({ revokedAt: new Date() }).where(and(
      eq(schema.invite.id, req.params.inviteId),
      eq(schema.invite.bandId, band.id),
      isNull(schema.invite.acceptedAt),
      isNull(schema.invite.revokedAt),
    )).returning({ id: schema.invite.id });
    if (!row) throw new HttpError(404, 'No pending invite with that id');
    await audit(tx, band, actor, 'invite.revoke', row.id);
  });
  return ok();
}

type InviteStatus = 'valid' | 'expired' | 'used' | 'revoked';

function inviteStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InviteStatus {
  if (i.revokedAt) return 'revoked';
  if (i.acceptedAt) return 'used';
  if (i.expiresAt.getTime() < Date.now()) return 'expired';
  return 'valid';
}

async function inviteByToken(token: string) {
  const [row] = await db().select({
    invite: schema.invite,
    band: { legacyId: schema.band.legacyId, slug: schema.band.slug, name: schema.band.name },
    inviter: schema.appUser.displayName,
  }).from(schema.invite)
    .innerJoin(schema.band, eq(schema.band.id, schema.invite.bandId))
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.invite.createdBy))
    .where(and(eq(schema.invite.tokenHash, hashToken(token)), isNull(schema.band.deletedAt)));
  if (!row) throw new HttpError(404, 'This invite link isn’t valid');
  return row;
}

/**
 * `GET /api/invites/:token` — what the invite page shows before sign-in.
 * Public: holding the token is the authorization.
 */
export async function previewInvite(req: CoreRequest): Promise<CoreResponse> {
  const { invite, band, inviter } = await inviteByToken(req.params.token);
  return json({
    band: { id: band.legacyId, slug: band.slug, name: band.name },
    role: invite.role,
    invitedBy: inviter,
    email: invite.email,
    expiresAt: invite.expiresAt,
    status: inviteStatus(invite),
  });
}

/** `POST /api/invites/:token/accept` — join the band as the signed-in user. */
export async function acceptInvite(req: CoreRequest): Promise<CoreResponse> {
  if (!req.actor) throw new HttpError(401, 'Sign in required');
  const actor = req.actor;
  const tokenHash = hashToken(req.params.token);

  const result = await db().transaction(async (tx) => {
    // Lock the row: two people racing on one link can't both get in.
    const [invite] = await tx.select().from(schema.invite)
      .where(eq(schema.invite.tokenHash, tokenHash)).for('update');
    if (!invite) throw new HttpError(404, 'This invite link isn’t valid');
    const status = inviteStatus(invite);
    if (status !== 'valid') {
      throw new HttpError(410, {
        expired: 'This invite has expired — ask for a new link',
        used: 'This invite has already been used',
        revoked: 'This invite was cancelled',
      }[status]);
    }
    if (invite.email && invite.email.toLowerCase() !== actor.email.toLowerCase()) {
      throw new HttpError(403, `This invite is for ${invite.email}. You're signed in as ${actor.email}.`);
    }

    const [band] = await tx.select().from(schema.band).where(eq(schema.band.id, invite.bandId));
    const ref: BandRef = { id: band.id, legacyId: band.legacyId, slug: band.slug, name: band.name, ownerUserId: band.ownerUserId, visibility: band.visibility };
    const isOwner = band.ownerUserId === actor.userId;
    const [existing] = await tx.select({ role: schema.membership.role }).from(schema.membership)
      .where(and(eq(schema.membership.bandId, band.id), eq(schema.membership.userId, actor.userId)));

    if (!isOwner && !existing) {
      await tx.insert(schema.membership).values({ userId: actor.userId, bandId: band.id, role: invite.role });
    } else if (existing && (await roleRank(invite.role)) < (await roleRank(existing.role))) {
      // An invite never demotes; it can promote an existing member.
      await tx.update(schema.membership).set({ role: invite.role })
        .where(and(eq(schema.membership.bandId, band.id), eq(schema.membership.userId, actor.userId)));
    }
    await tx.update(schema.invite).set({ acceptedAt: new Date(), acceptedBy: actor.userId })
      .where(eq(schema.invite.id, invite.id));
    await audit(tx, ref, actor, 'invite.accept', invite.id, { role: invite.role });
    return { band: { id: band.legacyId, slug: band.slug, name: band.name } };
  });
  return json(result);
}


// -------------------------------------------------------------- visibility

/**
 * `PUT /api/bands/:bandId/visibility` `{ visibility: 'public' | 'private' }`.
 * `band.publish` is the Owner's alone. Members-only hides the band in the
 * app; its R2 objects stay publicly fetchable until Phase 7.
 */
export async function setVisibility(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'band.publish', band);
  const { visibility } = (req.body ?? {}) as { visibility?: string };
  if (visibility !== 'public' && visibility !== 'private') {
    throw new HttpError(400, 'visibility must be "public" or "private"');
  }
  if (visibility === band.visibility) return ok();
  await db().transaction(async (tx) => {
    await tx.update(schema.band).set({ visibility }).where(eq(schema.band.id, band.id));
    await audit(tx, band, actor, 'band.publish', band.id, { from: band.visibility, to: visibility });
  });
  return ok();
}
