/**
 * End-to-end checks for the server's defenses: rate limits, body limits,
 * input checks on uploads, the sign-in redirect, error hygiene and security
 * headers.
 *
 *   npm run build && npm run build:server
 *   PORT=18562 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-security.ts --url http://localhost:18562
 *
 * Run it against a fresh server on a scratch database with R2 blanked: it
 * spends the rate limits for 127.0.0.1, so run it last, or restart the
 * server after. Creates a throwaway user and band and deletes them in
 * `finally`.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-security.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vs-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

async function call(cookie: string | null, method: string, path: string, body?: BodyInit, type = 'application/json') {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== 'GET' ? { origin: base!, 'content-type': type } : {}),
    },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers, text };
}

async function main(): Promise<void> {
  let userId: string | undefined;
  let memberId: string | undefined;
  try {
    const [u] = await sql`insert into app_user (email, display_name) values (${`${TAG}@example.invalid`}, 'Sec') returning id`;
    userId = u.id as string;
    const token = randomBytes(32).toString('base64url');
    await sql`insert into session (token_hash, user_id, expires_at)
              values (${createHash('sha256').update(token).digest('hex')}, ${userId}, now() + interval '10 minutes')`;
    const me = `pp_session=${token}`;
    const colors = { primary: '#4a31f5', accent: '#f59e0b', background: '#080e22', text: '#e5e7eb' };
    const band = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: BAND, name: 'Sec Band', route: TAG, colors, ...extra });

    console.log('--- input checks');
    check('a band website must be http(s)', (await call(me, 'PUT', `/api/bands/${BAND}`, band({ website: 'javascript:alert(1)' }))).status === 400);
    check('a band route can’t hold a slash', (await call(me, 'PUT', `/api/bands/${BAND}`, band({ route: 'a/b' }))).status === 400);
    const created = await call(me, 'PUT', `/api/bands/${BAND}`, band({ website: 'https://example.com' }));
    check('a valid band saves', created.status === 200, JSON.stringify(created.json));
    const del = await call(me, 'DELETE', `/api/bands/${BAND}/songs/s1/file/config.json`);
    check('the score-delete route refuses config.json', del.status === 400, String(del.status));
    const presign = await call(me, 'POST', '/api/r2/presign', JSON.stringify({ bandId: BAND, songId: 's1', files: ['config.json'] }));
    check('presign refuses anything but a score file', presign.status === 400, String(presign.status));
    const traversal = await call(me, 'POST', '/api/r2/presign', JSON.stringify({ bandId: BAND, songId: '../other', files: ['score.mxl'] }));
    check('presign refuses a path in songId', traversal.status === 400, String(traversal.status));
    const unsized = await call(me, 'POST', '/api/r2/presign', JSON.stringify({ bandId: BAND, songId: 's1', files: ['score.mxl'] }));
    check('presign needs each score’s size', unsized.status === 400, String(unsized.status));
    const huge = await call(me, 'POST', '/api/r2/presign', JSON.stringify({ bandId: BAND, songId: 's1', files: ['score.mxl'], sizes: [51 * 1024 * 1024] }));
    check('presign refuses a score over 50 MB', huge.status === 400, String(huge.status));
    const rename = await call(me, 'POST', `/api/bands/${BAND}/songs/s1/rename`, JSON.stringify({ newId: '../other' }));
    check('a song can’t be renamed to a path', rename.status === 400, String(rename.status));
    const disco = await call(me, 'POST', `/api/bands/${BAND}/songs/discography`, JSON.stringify({ id: 'a/b', title: 'T', artist: 'A' }));
    check('a discography entry needs a plain song id', disco.status === 400, String(disco.status));
    const htmlLogo = new FormData();
    htmlLogo.append('logo', new Blob(['<script>alert(1)</script>']), 'logo.html');
    const htmlRes = await fetch(`${base}/api/bands/${BAND}/logo`, { method: 'POST', headers: { cookie: me, origin: base! }, body: htmlLogo });
    check('a logo must be an image type', htmlRes.status === 400, String(htmlRes.status));

    console.log('\n--- media');
    const anonMedia = await call(null, 'GET', `/api/media/${BAND}/songs/s1/bass.opus`);
    check('a Members-only band’s audio needs sign-in', anonMedia.status === 401, String(anonMedia.status));
    const jsonMedia = await call(me, 'GET', `/api/media/${BAND}/songs/s1/config.json`);
    check('the media route serves no JSON documents', jsonMedia.status === 404, String(jsonMedia.status));
    // An encoded slash, so fetch can't resolve the `..` before it's sent.
    const dotMedia = await call(me, 'GET', `/api/media/${BAND}/songs%2F..%2Fx.opus`);
    check('the media route refuses ..', dotMedia.status === 404, String(dotMedia.status));
    const noBand = await call(me, 'GET', `/api/media/_incoming/abc/raw.wav`);
    check('raw uploads aren’t media', noBand.status === 404, String(noBand.status));

    console.log('\n--- band cap');
    const extra: number[] = [];
    for (const n of [2, 3, 4]) {
      extra.push((await call(me, 'PUT', `/api/bands/${BAND}${n}`, JSON.stringify({ id: `${BAND}${n}`, name: 'Sec Band', route: `${TAG}${n}`, colors }))).status);
    }
    check('a user can own 3 bands', extra[0] === 200 && extra[1] === 200, extra.join(','));
    check('…the 4th is a 403', extra[2] === 403, extra.join(','));

    console.log('\n--- account');
    const exported = await call(me, 'GET', '/api/me/export');
    check('a user can download their data', exported.status === 200 && /attachment/.test(exported.headers.get('content-disposition') ?? '') && (exported.json.account as { email?: string })?.email === `${TAG}@example.invalid`, String(exported.status));
    check('…signed out, no', (await call(null, 'GET', '/api/me/export')).status === 401);
    const ownerDelete = await call(me, 'DELETE', '/api/me');
    check('an Owner can’t delete their account', ownerDelete.status === 409, `${ownerDelete.status} ${JSON.stringify(ownerDelete.json)}`);

    // A member deletes their account: their address leaves the bands' records,
    // and the admin list stops showing them.
    const [m] = await sql`insert into app_user (email, display_name) values (${`${TAG}-m@example.invalid`}, 'Leaving') returning id`;
    memberId = m.id as string;
    const mToken = randomBytes(32).toString('base64url');
    await sql`insert into session (token_hash, user_id, expires_at)
              values (${createHash('sha256').update(mToken).digest('hex')}, ${m.id}, now() + interval '10 minutes')`;
    const [bandRow] = await sql`select id from band where legacy_id = ${BAND}`;
    await sql`insert into membership (user_id, band_id, role) values (${m.id}, ${bandRow.id}, 'member')`;
    const mEmail = `${TAG}-m@example.invalid`;
    await sql`insert into invite (band_id, email, role, token_hash, expires_at, created_by)
              values (${bandRow.id}, ${mEmail.toUpperCase()}, 'member', ${randomBytes(16).toString('hex')}, now() + interval '1 day', ${userId})`;
    await sql`insert into audit_log (band_id, actor_id, action, target, diff)
              values (${bandRow.id}, ${userId}, 'invite.create', 'x', ${sql.json({ role: 'member', email: mEmail, emailed: false })})`;
    const gone = await call(`pp_session=${mToken}`, 'DELETE', '/api/me');
    check('a member can delete their account', gone.status === 200, `${gone.status} ${JSON.stringify(gone.json)}`);
    const [after] = await sql`select deleted_at, email, last_sign_in_at from app_user where id = ${m.id}`;
    check('…the row is marked deleted and emptied', !!after.deleted_at && after.email.endsWith('@deleted.invalid') && after.last_sign_in_at === null);
    const [{ n: invites }] = await sql`select count(*)::int n from invite where lower(email) = lower(${mEmail})`;
    check('…unused invites to their address are gone', invites === 0, String(invites));
    const [{ n: audits }] = await sql`select count(*)::int n from audit_log where diff->>'email' = ${mEmail}`;
    check('…and the audit log no longer names it', audits === 0, String(audits));

    console.log('\n--- bodies');
    const malformed = await call(me, 'POST', `/api/access/${TAG}`, '{"message": ');
    check('malformed JSON is a 400', malformed.status === 400 && malformed.json.error === 'Malformed JSON', `${malformed.status} ${JSON.stringify(malformed.json)}`);
    const big = await call(me, 'POST', `/api/access/${TAG}`, JSON.stringify({ message: 'x'.repeat(3 * 1024 * 1024) }));
    check('a 3 MB JSON body is a 413', big.status === 413, `${big.status} ${JSON.stringify(big.json)}`);
    const form = new FormData();
    form.append('logo', new Blob([new Uint8Array(6 * 1024 * 1024)]), 'logo.png');
    const logoRes = await fetch(`${base}/api/bands/${BAND}/logo`, { method: 'POST', headers: { cookie: me, origin: base! }, body: form });
    check('a 6 MB logo is a 413', logoRes.status === 413, String(logoRes.status));

    console.log('\n--- errors');
    const dbErr = await call(me, 'DELETE', `/api/bands/${BAND}/invites/not-a-uuid`);
    check('a database error doesn’t reach the client', !/Failed query|select|params/i.test(JSON.stringify(dbErr.json)), JSON.stringify(dbErr.json));

    console.log('\n--- sign-in redirect');
    const tab = await call(null, 'GET', `/api/auth/google/start?next=${encodeURIComponent('/\t/evil.example')}`);
    const cookie = tab.headers.get('set-cookie') ?? '';
    check('a next path with a tab in it is dropped', tab.status === 302 && !/evil/.test(decodeURIComponent(cookie)), cookie.slice(0, 120));

    console.log('\n--- headers');
    const page = await fetch(`${base}/`);
    check('pages refuse framing', /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') ?? '') && page.headers.get('x-frame-options') === 'DENY');
    check('pages set a Referrer-Policy', page.headers.get('referrer-policy') === 'strict-origin-when-cross-origin');
    check('pages report scripts from anywhere but us and YouTube', /script-src 'self' https:\/\/www\.youtube\.com/.test(page.headers.get('content-security-policy-report-only') ?? ''));
    check('API responses set nosniff', (await fetch(`${base}/api/me`)).headers.get('x-content-type-options') === 'nosniff');

    console.log('\n--- rate limits');
    const starts: number[] = [];
    for (let i = 0; i < 6; i++) starts.push((await call(null, 'GET', '/api/auth/google/start')).status);
    const sixth = await call(null, 'GET', '/api/auth/google/start');
    check('5 sign-in starts are allowed', starts.slice(0, 4).every((s) => s === 302), starts.join(','));
    check('…the 6th goes home with a message', /signin_error=Too%20many%20sign-in%20attempts/.test(sixth.headers.get('location') ?? ''), sixth.headers.get('location') ?? '');
    check('…with Retry-After', Number(sixth.headers.get('retry-after')) > 0);
    const tokens: number[] = [];
    for (let i = 0; i < 31; i++) tokens.push((await call(null, 'GET', `/api/invites/${randomBytes(8).toString('hex')}`)).status);
    check('30 invite-link lookups are allowed', tokens.slice(0, 30).every((s) => s !== 429), tokens.slice(0, 30).join(','));
    check('…the 31st is a 429', tokens[30] === 429, String(tokens[30]));
  } finally {
    for (const b of await sql`select id from band where legacy_id like ${`${BAND}%`}`) {
      await sql`delete from audit_log where band_id = ${b.id}`;
      await sql`delete from band where id = ${b.id}`;
    }
    if (memberId) {
      await sql`delete from audit_log where actor_id = ${memberId}`;
      await sql`delete from app_user where id = ${memberId}`;
    }
    if (userId) {
      await sql`delete from audit_log where actor_id = ${userId}`;
      await sql`delete from session where user_id = ${userId}`;
      await sql`delete from app_user where id = ${userId}`;
    }
    await sql.end();
  }
  console.log(`\n===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
