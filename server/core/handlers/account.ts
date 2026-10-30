/**
 * A user's own account: download what we hold about them, or delete it.
 * Both are rights the privacy policy promises, so neither needs an email.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { clearCookie } from '../auth/cookies';
import { SESSION_COOKIE } from '../auth/sessions';
import { HttpError, json, ok } from '../http';
import type { CoreRequest, CoreResponse } from '../types';

function actorOf(req: CoreRequest) {
  if (!req.actor) throw new HttpError(401, 'Sign in required');
  return req.actor;
}

/** `GET /api/me/export` — everything tied to the account, as one JSON file. */
export async function exportAccount(req: CoreRequest): Promise<CoreResponse> {
  const { userId } = actorOf(req);
  const d = db();
  const [user] = await d.select({
    email: schema.appUser.email,
    name: schema.appUser.displayName,
    avatarUrl: schema.appUser.avatarUrl,
    createdAt: schema.appUser.createdAt,
    lastSignInAt: schema.appUser.lastSignInAt,
    termsVersion: schema.appUser.termsVersion,
    termsAcceptedAt: schema.appUser.termsAcceptedAt,
  }).from(schema.appUser).where(eq(schema.appUser.id, userId));

  const bands = await d.select({ band: schema.band.name, role: schema.membership.role, joinedAt: schema.membership.joinedAt })
    .from(schema.membership).innerJoin(schema.band, eq(schema.band.id, schema.membership.bandId))
    .where(and(eq(schema.membership.userId, userId), isNull(schema.band.deletedAt)));
  const owned = await d.select({ band: schema.band.name }).from(schema.band)
    .where(and(eq(schema.band.ownerUserId, userId), isNull(schema.band.deletedAt)));

  // Notes live in each song's notes document; keep the ones they wrote.
  const songs = await d.select({ band: schema.band.name, song: schema.song.title, notes: schema.song.notes })
    .from(schema.song).innerJoin(schema.band, eq(schema.band.id, schema.song.bandId))
    .where(and(
      isNull(schema.song.deletedAt),
      isNull(schema.band.deletedAt),
      sql`${schema.song.notes}->'notes' @> ${JSON.stringify([{ authorId: userId }])}::jsonb`,
    ));
  const notes = songs.flatMap(({ band, song, notes: doc }) =>
    ((doc as { notes?: { authorId?: string; time: number; text: string; deletedAt?: string }[] } | null)?.notes ?? [])
      .filter((n) => n.authorId === userId && !n.deletedAt)
      .map((n) => ({ band, song, time: n.time, text: n.text })));

  const personal = await d.select({ band: schema.band.name, song: schema.song.title, state: schema.userSongState.state })
    .from(schema.userSongState)
    .innerJoin(schema.song, eq(schema.song.id, schema.userSongState.songId))
    .innerJoin(schema.band, eq(schema.band.id, schema.song.bandId))
    .where(eq(schema.userSongState.userId, userId));

  const requests = await d.select({
    band: schema.band.name, message: schema.accessRequest.message, status: schema.accessRequest.status, createdAt: schema.accessRequest.createdAt,
  }).from(schema.accessRequest).innerJoin(schema.band, eq(schema.band.id, schema.accessRequest.bandId))
    .where(eq(schema.accessRequest.userId, userId));

  const body = {
    exportedAt: new Date().toISOString(),
    account: user,
    bands: [...owned.map((b) => ({ ...b, role: 'owner' })), ...bands],
    notes,
    personalSongState: personal,
    joinRequests: requests,
  };
  return { ...json(body), headers: { 'Content-Disposition': 'attachment; filename="practice-portal-data.json"' } };
}

/**
 * `DELETE /api/me` — delete the account. Refused while they own a band: the
 * band and everyone's work in it would go with them, so they hand it on or
 * delete it first.
 *
 * The row stays, emptied and marked `deleted_at`: the audit log and notes
 * point at it, and keep meaning "someone who has left" (notes show as "Band
 * member"). What's left (an id and two dates) identifies nobody. Email,
 * name, picture, Google id and sign-in dates go, so the same Google account
 * can sign up fresh. Memberships, sessions, personal song state and join
 * requests are deleted. Their address also leaves the bands' records: unused
 * invites to it are deleted, used ones lose it, and so do the audit entries
 * that note it.
 *
 * The email block list keeps the address if it's on it: that's how "never
 * email me" stays true.
 */
export async function deleteAccount(req: CoreRequest): Promise<CoreResponse> {
  const { userId, email } = actorOf(req);
  const owned = await db().select({ name: schema.band.name }).from(schema.band)
    .where(and(eq(schema.band.ownerUserId, userId), isNull(schema.band.deletedAt)));
  if (owned.length) {
    throw new HttpError(409, `You own ${owned.map((b) => b.name).join(', ')}. Hand ${owned.length > 1 ? 'them' : 'it'} to another member or delete ${owned.length > 1 ? 'them' : 'it'} first.`);
  }

  await db().transaction(async (tx) => {
    await tx.delete(schema.membership).where(eq(schema.membership.userId, userId));
    await tx.delete(schema.userSongState).where(eq(schema.userSongState.userId, userId));
    await tx.delete(schema.accessRequest).where(eq(schema.accessRequest.userId, userId));
    await tx.delete(schema.session).where(eq(schema.session.userId, userId));
    const theirs = sql`lower(${schema.invite.email}) = lower(${email})`;
    await tx.delete(schema.invite).where(and(theirs, isNull(schema.invite.acceptedAt)));
    await tx.update(schema.invite).set({ email: null }).where(and(theirs, isNotNull(schema.invite.acceptedAt)));
    await tx.update(schema.auditLog).set({ diff: sql`${schema.auditLog.diff} - 'email'` })
      .where(sql`${schema.auditLog.action} = 'invite.create' and lower(${schema.auditLog.diff}->>'email') = lower(${email})`);
    await tx.update(schema.appUser).set({
      email: `deleted-${userId}@deleted.invalid`,
      displayName: null,
      avatarUrl: null,
      googleSub: null,
      lastSignInAt: null,
      lastSeenAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      deletedAt: new Date(),
    }).where(eq(schema.appUser.id, userId));
    await tx.insert(schema.auditLog).values({ actorId: userId, action: 'account.delete', target: userId });
  });
  return { ...ok(), headers: { 'Set-Cookie': [clearCookie(SESSION_COOKIE)] } };
}
