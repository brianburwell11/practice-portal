/**
 * Server-side sessions. The browser holds a random token in `pp_session`;
 * Postgres holds only its SHA-256, so reading the session table doesn't hand
 * anyone a working cookie. Expiry is absolute, and every sign-in issues a new
 * token rather than reusing one (no session fixation).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import type { Actor } from '../types';

export const SESSION_COOKIE = 'pp_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Don't write `last_seen_at` on every request — once an hour is plenty. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await db().insert(schema.session).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000),
  });
  // Opportunistic cleanup; sessions are small and few.
  await db().delete(schema.session).where(lt(schema.session.expiresAt, new Date(now)));
  return token;
}

/** The user behind a session token, or undefined if it's unknown or expired. */
export async function resolveSession(token: string): Promise<Actor | undefined> {
  const tokenHash = hashToken(token);
  const [row] = await db()
    .select({
      userId: schema.appUser.id,
      email: schema.appUser.email,
      lastSeenAt: schema.session.lastSeenAt,
    })
    .from(schema.session)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.session.userId))
    .where(and(eq(schema.session.tokenHash, tokenHash), gt(schema.session.expiresAt, new Date())));
  if (!row) return undefined;

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().update(schema.session).set({ lastSeenAt: new Date() })
      .where(eq(schema.session.tokenHash, tokenHash));
  }
  return { kind: 'user', userId: row.userId, email: row.email, sessionHash: tokenHash };
}

export async function deleteSession(sessionHash: string): Promise<void> {
  await db().delete(schema.session).where(eq(schema.session.tokenHash, sessionHash));
}
