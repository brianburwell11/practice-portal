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
    const [b] = await sql`select id from band where legacy_id = ${BAND}`;
    if (b) {
      await sql`delete from audit_log where band_id = ${b.id}`;
      await sql`delete from band where id = ${b.id}`;
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
