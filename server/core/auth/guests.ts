/**
 * Guest links for subs (Phase 10). Each band has at most one "anyone with the
 * link" link, `/<band>?guest=<token>`; Owners and Managers turn it on, reset
 * it, or turn it off. The SPA sees `guest=` and calls `POST /api/guest/<token>`,
 * which adds the token to the `pp_guest` cookie — it can hold links from
 * several bands at once — and every request resolves that cookie back to the
 * links that are still live.
 *
 * A guest is not an `Actor`. A live link reads its band the way a Member
 * does — every song and setlist — and nothing more: write routes all require
 * a signed-in user, so they refuse a guest without knowing guests exist.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { hashToken } from './sessions';

export const GUEST_COOKIE = 'pp_guest';
/** A link may never expire, so neither does the cookie, practically: a year, renewed on each open. */
export const GUEST_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Links one device keeps; opening another drops the oldest. */
const MAX_TOKENS = 10;

/** Don't write `last_used_at` on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface GuestGrant {
  linkId: string;
  /** `band.id` — the uuid, not the legacy id. */
  bandId: string;
  band: { id: string; slug: string; name: string };
  /** Null: no expiry. */
  expiresAt: Date | null;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 16;

/**
 * A guest link's secret: 16 letters and digits, about 95 bits — far past
 * guessing, and short enough to read out or paste without a chat app
 * clipping punctuation off the end. Sessions and invites keep 32 bytes;
 * nobody types those.
 */
export function newGuestToken(): string {
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH * 2)) {
      // 248 = 4 × 62: rejecting the rest keeps every character equally likely.
      if (byte < 248 && out.length < TOKEN_LENGTH) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

/** Anything a guest cookie might hold: today's 16-character tokens up to 64, for slack. */
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** The tokens in a `pp_guest` value, malformed ones dropped. */
export function guestTokens(cookie: string | undefined): string[] {
  return (cookie ?? '').split('.').filter((t) => TOKEN.test(t));
}

/** A `pp_guest` value holding `token` plus the newest of `existing`. */
export function addGuestToken(existing: string[], token: string): string {
  return [...existing.filter((t) => t !== token), token].slice(-MAX_TOKENS).join('.');
}

/** A link that hasn't been turned off, reset, or reached its expiry. */
export const liveLink = () => and(
  eq(schema.grantLink.scope, 'band'),
  isNull(schema.grantLink.revokedAt),
  or(isNull(schema.grantLink.expiresAt), gt(schema.grantLink.expiresAt, new Date())),
);

/** The live links among `tokens`, bands not deleted. Unknown and dead tokens are simply absent. */
export async function resolveGuests(tokens: string[]): Promise<GuestGrant[]> {
  if (tokens.length === 0) return [];
  const rows = await db().select({
    link: schema.grantLink,
    band: { id: schema.band.legacyId, slug: schema.band.slug, name: schema.band.name },
  }).from(schema.grantLink)
    .innerJoin(schema.band, eq(schema.band.id, schema.grantLink.bandId))
    .where(and(
      inArray(schema.grantLink.tokenHash, tokens.map(hashToken)),
      liveLink(),
      isNull(schema.band.deletedAt),
    ));

  const stale = rows
    .filter((r) => !r.link.lastUsedAt || Date.now() - r.link.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
    .map((r) => r.link.id);
  if (stale.length) {
    await db().update(schema.grantLink).set({ lastUsedAt: new Date() }).where(and(
      inArray(schema.grantLink.id, stale),
      // Another request may have just touched it.
      or(isNull(schema.grantLink.lastUsedAt), lt(schema.grantLink.lastUsedAt, new Date(Date.now() - TOUCH_INTERVAL_MS))),
    ));
  }

  return rows.map(({ link, band }) => ({
    linkId: link.id,
    bandId: link.bandId,
    band: { id: band.id ?? '', slug: band.slug, name: band.name },
    expiresAt: link.expiresAt,
  }));
}

/** What the SPA is told about a guest link it holds — never the token or its hash. */
export function guestView(g: GuestGrant) {
  return { band: g.band, expiresAt: g.expiresAt };
}
