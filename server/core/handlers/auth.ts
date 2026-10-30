import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { isPlatformAdmin } from '../access';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { clearCookie, setCookie } from '../auth/cookies';
import { beginSignIn, finishSignIn, type GoogleIdentity, type PendingSignIn } from '../auth/google';
import { guestView } from '../auth/guests';
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth/sessions';
import { HttpError, json, ok } from '../http';
import type { CoreRequest, CoreResponse } from '../types';
import { TERMS_VERSION } from '../../../src/config/legal';

const PENDING_COOKIE = 'pp_oauth';
const PENDING_PATH = '/api/auth/google';
const PENDING_TTL_SECONDS = 10 * 60;

/**
 * Only same-site paths: `/x`, never `//evil.com`, `/\evil.com`, or one with a
 * tab or newline in it (browsers drop those, so `/\t/evil.com` is `//evil.com`).
 */
function safeNext(next: string | null): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\x00-\x1f\x7f]/.test(next)) return '/';
  return next;
}

function redirect(location: string, cookies: string[] = []): CoreResponse {
  return { status: 302, body: null, headers: { Location: location, 'Set-Cookie': cookies } };
}

/** `GET /api/auth/google/start?next=/path` — off to Google's account chooser. */
export async function googleStart(req: CoreRequest): Promise<CoreResponse> {
  const { url, pending } = beginSignIn(req.origin, safeNext(req.query.get('next')));
  if (req.query.get('terms') === '1') pending.agreedTerms = true;
  const value = Buffer.from(JSON.stringify(pending)).toString('base64url');
  return redirect(url, [setCookie(PENDING_COOKIE, value, { maxAge: PENDING_TTL_SECONDS, path: PENDING_PATH })]);
}

/**
 * Find or create the account for a Google identity. Matches on Google's
 * stable `sub` first; failing that, a verified email links an account that
 * has never signed in (the owner the R2 import created, or a future
 * pre-provisioned member) instead of creating a duplicate.
 */
async function upsertUser(g: GoogleIdentity): Promise<string> {
  const profile = { displayName: g.name ?? null, avatarUrl: g.picture ?? null };
  return db().transaction(async (tx) => {
    const [bySub] = await tx.select({ id: schema.appUser.id }).from(schema.appUser)
      .where(eq(schema.appUser.googleSub, g.sub));
    if (bySub) {
      // Follow an email change on the Google side, unless another account holds it.
      const [clash] = await tx.select({ id: schema.appUser.id }).from(schema.appUser)
        .where(and(eq(schema.appUser.email, g.email), ne(schema.appUser.id, bySub.id)));
      await tx.update(schema.appUser).set({ ...profile, ...(clash ? {} : { email: g.email }) })
        .where(eq(schema.appUser.id, bySub.id));
      return bySub.id;
    }

    const [byEmail] = await tx.select({ id: schema.appUser.id, googleSub: schema.appUser.googleSub })
      .from(schema.appUser).where(eq(schema.appUser.email, g.email));
    if (byEmail) {
      if (byEmail.googleSub) {
        // The address belongs to a different Google account than the one we
        // know. Don't silently re-point an existing account at a new identity.
        throw new HttpError(409, `${g.email} is already linked to a different Google account`);
      }
      await tx.update(schema.appUser).set({ ...profile, googleSub: g.sub })
        .where(and(eq(schema.appUser.id, byEmail.id), isNull(schema.appUser.googleSub)));
      return byEmail.id;
    }

    const [created] = await tx.insert(schema.appUser)
      .values({ email: g.email, googleSub: g.sub, ...profile })
      .returning({ id: schema.appUser.id });
    return created.id;
  });
}

/** `GET /api/auth/google/callback` — Google sends the browser back here. */
export async function googleCallback(req: CoreRequest): Promise<CoreResponse> {
  const clearPending = clearCookie(PENDING_COOKIE, PENDING_PATH);
  let pending: PendingSignIn | undefined;
  try {
    pending = JSON.parse(Buffer.from(req.cookies[PENDING_COOKIE] ?? '', 'base64url').toString('utf8')) as PendingSignIn;
  } catch {
    // fall through to the check below
  }
  const fail = (why: string) =>
    redirect(`${safeNext(pending?.next ?? null)}${pending?.next?.includes('?') ? '&' : '?'}signin_error=${encodeURIComponent(why)}`, [clearPending]);

  if (!pending?.state) return fail('Your sign-in expired. Please try again.');
  // The state ties this callback to the browser that started the sign-in.
  if (req.query.get('state') !== pending.state) return fail('Sign-in could not be verified. Please try again.');
  if (req.query.get('error')) return fail(req.query.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed.');
  const code = req.query.get('code');
  if (!code) return fail('Google sign-in failed.');

  try {
    const identity = await finishSignIn(req.origin, code, pending);
    const userId = await upsertUser(identity);
    if (pending.agreedTerms) {
      await db().update(schema.appUser).set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() })
        .where(eq(schema.appUser.id, userId));
    }
    // A fresh token every sign-in; end the browser's previous session if it had one.
    if (req.actor) await deleteSession(req.actor.sessionHash);
    const token = await createSession(userId);
    return redirect(safeNext(pending.next), [
      clearPending,
      setCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS }),
    ]);
  } catch (err) {
    console.error('[auth] Google sign-in failed:', err);
    return fail(err instanceof HttpError ? err.message : 'Google sign-in failed.');
  }
}

/** `POST /api/auth/logout` */
export async function logout(req: CoreRequest): Promise<CoreResponse> {
  if (req.actor) await deleteSession(req.actor.sessionHash);
  return { ...ok(), headers: { 'Set-Cookie': [clearCookie(SESSION_COOKIE)] } };
}

/**
 * `GET /api/me` — the signed-in user and the bands they belong to, or
 * `{ user: null }`. Band ids are the legacy ids the SPA uses everywhere.
 */
export async function me(req: CoreRequest): Promise<CoreResponse> {
  // Lets the SPA hide the sign-in button on a server without Google configured.
  const signInEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  // Guest links this device holds, signed in or not.
  const guest = (req.guests ?? []).map(guestView);
  if (!req.actor) return json({ signInEnabled, user: null, bands: [], guest });
  const { userId } = req.actor;
  const [user] = await db().select({
    id: schema.appUser.id,
    email: schema.appUser.email,
    name: schema.appUser.displayName,
    avatarUrl: schema.appUser.avatarUrl,
  }).from(schema.appUser).where(eq(schema.appUser.id, userId));
  if (!user) throw new HttpError(401, 'Unknown user');

  const bandFields = { id: schema.band.legacyId, slug: schema.band.slug, name: schema.band.name };
  const owned = await db().select(bandFields).from(schema.band)
    .where(and(eq(schema.band.ownerUserId, userId), isNull(schema.band.deletedAt)));
  const joined = await db().select({ ...bandFields, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.band, eq(schema.band.id, schema.membership.bandId))
    .where(and(eq(schema.membership.userId, userId), isNull(schema.band.deletedAt)));

  const ownedIds = new Set(owned.map((b) => b.id));
  const bands = [
    ...owned.map((b) => ({ ...b, role: 'owner' })),
    ...joined.filter((b) => !ownedIds.has(b.id)),
  ];

  // Each band's capabilities, from the same role tables the server enforces
  // with, so the UI shows exactly the controls a request would be allowed.
  const roles = [...new Set(bands.map((b) => b.role))];
  const grants = roles.length
    ? await db().select({ role: schema.roleCapability.roleKey, cap: schema.roleCapability.capabilityKey })
      .from(schema.roleCapability).where(inArray(schema.roleCapability.roleKey, roles))
    : [];
  const capsByRole = new Map<string, string[]>();
  for (const g of grants) capsByRole.set(g.role, [...(capsByRole.get(g.role) ?? []), g.cap]);

  // A site admin acts as the Owner in bands they aren't in (support access):
  // the Owner's capabilities, for the app to show the same controls.
  const platformAdmin = isPlatformAdmin(req.actor);
  const supportCapabilities = platformAdmin
    ? (await db().select({ cap: schema.roleCapability.capabilityKey }).from(schema.roleCapability)
      .where(eq(schema.roleCapability.roleKey, 'owner'))).map((r) => r.cap).sort()
    : [];

  return json({
    signInEnabled,
    user,
    platformAdmin,
    supportCapabilities,
    bands: bands.map((b) => ({ ...b, capabilities: (capsByRole.get(b.role) ?? []).sort() })),
    guest,
  });
}

