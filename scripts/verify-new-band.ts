/**
 * End-to-end checks for starting a band: any signed-in user may create one,
 * owns it, and it starts Members only.
 *
 *   npm run build:server && PORT=18558 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-new-band.ts --url http://localhost:18558
 *
 * Creates two throwaway users (sessions minted directly — Google isn't
 * involved) and throwaway bands. Everything it creates is deleted in
 * `finally`, audit rows included. Run it against a scratch database with R2
 * blanked: band creation copies band.json and registry.json to R2.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-new-band.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vn-${randomBytes(3).toString('hex')}`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

interface User { id: string; email: string; cookie: string }

async function makeUser(name: string): Promise<User> {
  const email = `${TAG}-${name}@example.invalid`;
  const [u] = await sql`insert into app_user (email, display_name) values (${email}, ${name}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into session (token_hash, user_id, expires_at)
            values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, now() + interval '10 minutes')`;
  return { id: u.id as string, email, cookie: `pp_session=${token}` };
}

async function call(user: User | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(method !== 'GET' ? { origin: base!, 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty body */ }
  return { status: res.status, json };
}

const bandBody = (id: string, route: string) => ({
  id, name: `Band ${id}`, route,
  colors: { primary: '#3b82f6', accent: '#f59e0b', background: '#111827', text: '#f3f4f6' },
});

async function main(): Promise<void> {
  const users: User[] = [];
  const A = `${TAG}-a`;
  const B = `${TAG}-b`;
  try {
    const ann = await makeUser('ann');
    const ben = await makeUser('ben');
    users.push(ann, ben);

    console.log('--- creating');
    check('signed out can’t create a band', (await call(null, 'PUT', `/api/bands/${A}`, bandBody(A, A))).status === 401);
    const created = await call(ann, 'PUT', `/api/bands/${A}`, bandBody(A, A));
    check('a signed-in user (not a site admin) creates a band', created.status === 200, JSON.stringify(created));

    const [row] = await sql`select visibility, owner_user_id from band where legacy_id = ${A}`;
    check('it starts Members only', row?.visibility === 'private', row?.visibility);
    check('the creator owns it', row?.owner_user_id === ann.id);

    const me = await call(ann, 'GET', '/api/me');
    const mine = (me.json.bands as { id: string; role: string }[]).find((b) => b.id === A);
    check('/api/me lists it with the Owner role', mine?.role === 'owner', JSON.stringify(mine));

    console.log('\n--- who sees it');
    const seen = async (u: User | null) =>
      ((await call(u, 'GET', '/api/data/registry.json')).json.bands as { id: string }[] | undefined)?.some((b) => b.id === A);
    check('the Owner sees it in the registry', await seen(ann) === true);
    check('another user doesn’t', await seen(ben) === false);
    check('signed out doesn’t', await seen(null) === false);

    console.log('\n--- someone else’s band');
    const hijack = await call(ben, 'PUT', `/api/bands/${A}`, { ...bandBody(A, A), name: 'Mine now' });
    check('another user can’t overwrite it', hijack.status === 403 || hijack.status === 404, String(hijack.status));
    const taken = await call(ben, 'PUT', `/api/bands/${B}`, bandBody(B, A));
    check('its address is taken, though they can’t see it', taken.status === 400 && /taken/.test(String(taken.json.error)),
      JSON.stringify(taken));
    check('another user starts their own band', (await call(ben, 'PUT', `/api/bands/${B}`, bandBody(B, B))).status === 200);
  } finally {
    const bands = await sql`select id from band where legacy_id in (${A}, ${B})`;
    for (const { id } of bands) {
      await sql`delete from audit_log where band_id = ${id}`;
      await sql`delete from band where id = ${id}`;
    }
    for (const u of users) {
      await sql`delete from audit_log where actor_id = ${u.id}`;
      await sql`delete from session where user_id = ${u.id}`;
      await sql`delete from app_user where id = ${u.id}`;
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
