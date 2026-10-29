/**
 * The site admin dashboard's data (`/admin`), for addresses in ADMIN_EMAILS
 * only (routes declare `access: 'platformAdmin'`).
 *
 *   GET /api/admin/bands   every band: owner, songs, setlists, members, storage
 *   GET /api/admin/users   every user: when they joined, signed in and were
 *                          last seen, and their role in each band
 *
 * Storage is measured by listing each band's R2 prefix, only when the
 * dashboard asks: nothing runs in the background, and nothing is kept.
 */
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { isPlatformAdmin } from '../access';
import { ADMIN_FROM, emailEnabled, escapeHtml, htmlEmail, isBlocked, sendEmail } from '../email';
import { HttpError, json } from '../http';
import { r2StorageBytes } from '../r2';
import type { CoreRequest, CoreResponse } from '../types';

/** A band's R2 usage, or null where R2 isn't configured. */
async function storageOf(legacyId: string): Promise<{ bytes: number; files: number } | null> {
  try {
    const { totalBytes, objectCount } = await r2StorageBytes(`${legacyId}/`);
    return { bytes: totalBytes, files: objectCount };
  } catch (err) {
    console.error(`[admin] storage for ${legacyId} failed:`, err);
    return null;
  }
}

/** Rows grouped by band id, as a count. */
async function countsByBand(table: typeof schema.song | typeof schema.setlist): Promise<Map<string, number>> {
  const rows = await db().select({ bandId: table.bandId, n: count() }).from(table)
    .where(isNull(table.deletedAt)).groupBy(table.bandId);
  return new Map(rows.map((r) => [r.bandId, r.n]));
}

export async function adminBands(): Promise<CoreResponse> {
  const bands = await db().select({
    id: schema.band.id,
    legacyId: schema.band.legacyId,
    slug: schema.band.slug,
    name: schema.band.name,
    visibility: schema.band.visibility,
    createdAt: schema.band.createdAt,
    ownerName: schema.appUser.displayName,
    ownerEmail: schema.appUser.email,
  }).from(schema.band)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.band.ownerUserId))
    .where(isNull(schema.band.deletedAt));

  const [songs, setlists, members] = await Promise.all([
    countsByBand(schema.song),
    countsByBand(schema.setlist),
    db().select({ bandId: schema.membership.bandId, n: count() }).from(schema.membership)
      .groupBy(schema.membership.bandId).then((rows) => new Map(rows.map((r) => [r.bandId, r.n]))),
  ]);
  const storage = await Promise.all(bands.map((b) => (b.legacyId ? storageOf(b.legacyId) : null)));

  return json({
    bands: bands.map((b, i) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      visibility: b.visibility,
      createdAt: b.createdAt,
      owner: { name: b.ownerName, email: b.ownerEmail },
      songs: songs.get(b.id) ?? 0,
      setlists: setlists.get(b.id) ?? 0,
      // Members plus the Owner, who has no membership row.
      people: (members.get(b.id) ?? 0) + 1,
      storageBytes: storage[i]?.bytes ?? null,
      storageFiles: storage[i]?.files ?? null,
    })),
  });
}

export async function adminUsers(): Promise<CoreResponse> {
  const users = await db().select({
    id: schema.appUser.id,
    email: schema.appUser.email,
    name: schema.appUser.displayName,
    avatarUrl: schema.appUser.avatarUrl,
    createdAt: schema.appUser.createdAt,
    lastSignInAt: schema.appUser.lastSignInAt,
    lastSeenAt: schema.appUser.lastSeenAt,
  }).from(schema.appUser);

  const bandFields = { userBand: schema.band.slug, name: schema.band.name };
  const [owned, joined] = await Promise.all([
    db().select({ userId: schema.band.ownerUserId, ...bandFields }).from(schema.band)
      .where(isNull(schema.band.deletedAt)),
    db().select({ userId: schema.membership.userId, role: schema.membership.role, ...bandFields })
      .from(schema.membership)
      .innerJoin(schema.band, and(eq(schema.band.id, schema.membership.bandId), isNull(schema.band.deletedAt))),
  ]);
  const bandsOf = new Map<string, { slug: string; name: string; role: string }[]>();
  for (const r of [...owned.map((o) => ({ ...o, role: 'owner' })), ...joined]) {
    const list = bandsOf.get(r.userId) ?? [];
    list.push({ slug: r.userBand, name: r.name, role: r.role });
    bandsOf.set(r.userId, list);
  }

  return json({
    users: users.map((u) => ({
      ...u,
      siteAdmin: isPlatformAdmin({ kind: 'user', userId: u.id, email: u.email, sessionHash: '' }),
      bands: (bandsOf.get(u.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    })),
  });
}

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 5000;

/**
 * `POST /api/admin/users/:userId/email` `{ subject, message }`: email one user
 * from Practice Portal <admin@practiceportal.app>, with replies to the
 * signed-in site admin. Sent before answering, so the dashboard can say
 * whether it went. Addresses on the block list are refused.
 */
export async function emailUser(req: CoreRequest): Promise<CoreResponse> {
  const { subject, message } = (req.body ?? {}) as { subject?: unknown; message?: unknown };
  const s = typeof subject === 'string' ? subject.replace(/[\r\n]+/g, ' ').trim() : '';
  const m = typeof message === 'string' ? message.trim() : '';
  if (!s || s.length > SUBJECT_MAX) throw new HttpError(400, `The subject needs 1 to ${SUBJECT_MAX} characters`);
  if (!m || m.length > MESSAGE_MAX) throw new HttpError(400, `The message needs 1 to ${MESSAGE_MAX} characters`);

  const [to] = await db().select({ email: schema.appUser.email }).from(schema.appUser)
    .where(eq(schema.appUser.id, req.params.userId));
  if (!to) throw new HttpError(404, 'No such user');
  if (await isBlocked(to.email)) throw new HttpError(409, 'This address asked not to get emails from Practice Portal');

  const actor = req.actor!;
  const sent = await sendEmail({
    to: to.email,
    from: ADMIN_FROM,
    replyTo: actor.email,
    subject: s,
    text: m,
    // Just the message; htmlEmail's footer line is the only sign-off.
    html: htmlEmail(m.split(/\n{2,}/).map((p) => `<span style="white-space:pre-wrap">${escapeHtml(p)}</span>`)),
  });
  await db().insert(schema.auditLog).values({
    bandId: null, actorId: actor.userId, actorKind: 'support', action: 'admin.email_user',
    target: req.params.userId, diff: { subject: s, sent },
  });
  if (!sent && emailEnabled()) throw new HttpError(502, 'The email service didn’t accept it. Try again in a minute.');
  return json({ ok: true, sent });
}
