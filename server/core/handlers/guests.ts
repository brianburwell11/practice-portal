/**
 * The band's guest link (Phase 10) — see `auth/guests.ts` for how a link is
 * resolved on each request.
 *
 * Owners and Managers (`member.invite`) see and copy the link, turn it on,
 * reset it (a new token, so everyone holding the old one is cut off), change
 * when it expires, and turn it off. Every change is audited.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId, requireCan, type BandRef } from '../auth/can';
import { clearCookie, setCookie } from '../auth/cookies';
import {
  addGuestToken,
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  guestTokens,
  guestView,
  newGuestToken,
  resolveGuests,
} from '../auth/guests';
import { hashToken } from '../auth/sessions';
import { HttpError, json, ok } from '../http';
import type { CoreRequest, CoreResponse } from '../types';
import { audit, rateLimitInvites, type Tx } from './members';

/** The band's current link — on, or expired but not turned off. */
const currentLink = (band: BandRef) => and(
  eq(schema.grantLink.bandId, band.id),
  eq(schema.grantLink.scope, 'band'),
  isNull(schema.grantLink.revokedAt),
);

/** `{ expiresAt }` from a request body: absent or null for no expiry, else a future date. */
function parseExpiry(body: unknown): Date | null {
  const raw = (body as { expiresAt?: unknown } | undefined)?.expiresAt;
  if (raw === undefined || raw === null) return null;
  const at = typeof raw === 'string' ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) throw new HttpError(400, 'expiresAt must be a date, or null for no expiry');
  if (at.getTime() <= Date.now()) throw new HttpError(400, 'Pick an expiry date in the future');
  return at;
}

async function revokeCurrent(tx: Tx, band: BandRef): Promise<string | null> {
  const [row] = await tx.update(schema.grantLink).set({ revokedAt: new Date(), token: null })
    .where(currentLink(band)).returning({ id: schema.grantLink.id });
  return row?.id ?? null;
}

/** `GET /api/bands/:bandId/guest-link` — `{ link: null }` when it's off. */
export async function getGuestLink(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  await requireCan(req.actor, 'member.invite', band);
  const [row] = await db().select().from(schema.grantLink).where(currentLink(band));
  if (!row?.token) return json({ link: null });
  return json({
    link: {
      // The band's own address. Opening it with `guest=` sets the cookie; the
      // token, not the route, is what's checked, so a renamed route still works.
      url: `${req.origin}/${encodeURIComponent(band.slug)}?guest=${row.token}`,
      expiresAt: row.expiresAt,
      expired: !!row.expiresAt && row.expiresAt.getTime() <= Date.now(),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    },
  });
}

/**
 * `POST /api/bands/:bandId/guest-link` `{ expiresAt? }` — turn the link on,
 * or reset it: the old link stops working and a new one replaces it.
 */
export async function resetGuestLink(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  const expiresAt = parseExpiry(req.body);
  rateLimitInvites(actor.userId);

  const token = newGuestToken();
  try {
    await db().transaction(async (tx) => {
      const old = await revokeCurrent(tx, band);
      const [row] = await tx.insert(schema.grantLink).values({
        bandId: band.id, scope: 'band', targetId: band.id,
        token, tokenHash: hashToken(token), expiresAt, createdBy: actor.userId,
      }).returning({ id: schema.grantLink.id });
      await audit(tx, band, actor, old ? 'guest_link.reset' : 'guest_link.create', row.id, { replaced: old, expiresAt });
    });
  } catch (err) {
    // Two resets at once: the one-live-link index lets only one through.
    if (/grant_link_one_live_band_link/.test(String((err as { cause?: unknown })?.cause ?? err))) {
      throw new HttpError(409, 'Someone else just changed the link — reopen this window');
    }
    throw err;
  }
  return getGuestLink(req);
}

/** `PUT /api/bands/:bandId/guest-link` `{ expiresAt }` — change the expiry, same link. */
export async function setGuestLinkExpiry(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  const expiresAt = parseExpiry(req.body);
  await db().transaction(async (tx) => {
    const [row] = await tx.update(schema.grantLink).set({ expiresAt })
      .where(currentLink(band)).returning({ id: schema.grantLink.id });
    if (!row) throw new HttpError(404, 'The guest link is off');
    await audit(tx, band, actor, 'guest_link.expiry', row.id, { expiresAt });
  });
  return getGuestLink(req);
}

/** `DELETE /api/bands/:bandId/guest-link` — turn it off; takes effect on each guest's next request. */
export async function turnOffGuestLink(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const actor = await requireCan(req.actor, 'member.invite', band);
  await db().transaction(async (tx) => {
    const id = await revokeCurrent(tx, band);
    if (!id) throw new HttpError(404, 'The guest link is already off');
    await audit(tx, band, actor, 'guest_link.revoke', id);
  });
  return ok();
}

/**
 * `POST /api/guest/:token` — open a link on this device. Public: holding the
 * token is the authorization. Adds it to `pp_guest` and says which band.
 */
export async function openGuestLink(req: CoreRequest): Promise<CoreResponse> {
  const { token } = req.params;
  const [row] = await db().select({ link: schema.grantLink, bandDeletedAt: schema.band.deletedAt })
    .from(schema.grantLink)
    .innerJoin(schema.band, eq(schema.band.id, schema.grantLink.bandId))
    .where(eq(schema.grantLink.tokenHash, hashToken(token)));
  if (!row || row.bandDeletedAt) throw new HttpError(404, 'This link isn’t valid');
  if (row.link.revokedAt) throw new HttpError(410, 'This link was turned off — ask the band for the new one');
  if (row.link.expiresAt && row.link.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(410, 'This link has expired — ask the band for a new one');
  }

  // Resolve through the same path every later request takes.
  const [grant] = await resolveGuests([token]);
  if (!grant) throw new HttpError(410, 'This link isn’t valid any more');

  const value = addGuestToken(guestTokens(req.cookies[GUEST_COOKIE]), token);
  return {
    status: 200,
    body: guestView(grant),
    headers: { 'Set-Cookie': [setCookie(GUEST_COOKIE, value, { maxAge: GUEST_COOKIE_MAX_AGE })] },
  };
}

/** `DELETE /api/guest` — forget every guest link on this device. */
export async function leaveGuest(): Promise<CoreResponse> {
  return { ...ok(), headers: { 'Set-Cookie': [clearCookie(GUEST_COOKIE)] } };
}
