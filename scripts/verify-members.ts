/**
 * End-to-end checks for invites, the roster and ownership transfer, through a
 * running server and the database behind it.
 *
 *   npm run build:server && PORT=18557 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-members.ts --url http://localhost:18557
 *
 * Creates three throwaway users (sessions minted directly — Google isn't
 * involved) and a throwaway members-only band, so nothing appears on the
 * public site. Everything it creates is deleted in `finally`, audit rows
 * included.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-members.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vm-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;

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

const tokenOf = (url: unknown) => String(url).split('/invite/')[1];

async function main(): Promise<void> {
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const bea = await makeUser('bea');
    const cal = await makeUser('cal');
    users.push(owner, bea, cal);
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
              values (${BAND}, ${BAND}, 'Verify Members', '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}',
                      ${owner.id}, 'private')`;
    const roster = `/api/bands/${BAND}/members`;

    console.log('--- who may look');
    check('anonymous roster → 401', (await call(null, 'GET', roster)).status === 401);
    check('non-member roster → 403', (await call(bea, 'GET', roster)).status === 403);
    const r0 = await call(owner, 'GET', roster);
    check('owner sees just themselves', r0.status === 200 && (r0.json.members as unknown[]).length === 1, JSON.stringify(r0.json));

    console.log('\n--- open invite');
    const inv1 = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'editor' });
    check('owner creates an editor invite', inv1.status === 200 && String(inv1.json.url).includes('/invite/'), JSON.stringify(inv1.json));
    const t1 = tokenOf(inv1.json.url);
    const p1 = await call(null, 'GET', `/api/invites/${t1}`);
    check('anyone can preview it', p1.status === 200 && p1.json.status === 'valid' && p1.json.role === 'editor');
    check('accepting needs sign-in', (await call(null, 'POST', `/api/invites/${t1}/accept`)).status === 401);
    const a1 = await call(bea, 'POST', `/api/invites/${t1}/accept`);
    check('bea accepts', a1.status === 200, JSON.stringify(a1.json));
    check('preview now says used', (await call(null, 'GET', `/api/invites/${t1}`)).json.status === 'used');
    check('a used link can’t be reused', (await call(cal, 'POST', `/api/invites/${t1}/accept`)).status === 410);
    const me = await call(bea, 'GET', '/api/me');
    check('/api/me shows bea as editor', JSON.stringify(me.json.bands).includes(`"role":"editor"`), JSON.stringify(me.json));

    console.log('\n--- editors can’t manage people');
    check('editor can’t see the roster', (await call(bea, 'GET', roster)).status === 403);
    check('editor can’t invite', (await call(bea, 'POST', `/api/bands/${BAND}/invites`, { role: 'member' })).status === 403);

    console.log('\n--- email-locked invite');
    const inv2 = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member', email: cal.email.toUpperCase() });
    const t2 = tokenOf(inv2.json.url);
    const wrong = await call(bea, 'POST', `/api/invites/${t2}/accept`);
    check('wrong account refused, told which address', wrong.status === 403 && String(wrong.json.error).includes(cal.email.toUpperCase()), JSON.stringify(wrong.json));
    check('right account (any case) accepted', (await call(cal, 'POST', `/api/invites/${t2}/accept`)).status === 200);

    console.log('\n--- roles');
    check('owner makes bea a manager', (await call(owner, 'PUT', `${roster}/${bea.id}`, { role: 'manager' })).status === 200);
    check('nobody can grant owner', (await call(bea, 'PUT', `${roster}/${cal.id}`, { role: 'owner' })).status === 400);
    check('a manager can make managers', (await call(bea, 'PUT', `${roster}/${cal.id}`, { role: 'manager' })).status === 200);
    check('the owner can’t be edited', (await call(bea, 'PUT', `${roster}/${owner.id}`, { role: 'member' })).status === 400);
    check('the owner can’t be removed', (await call(bea, 'DELETE', `${roster}/${owner.id}`)).status === 400);
    const inv3 = await call(bea, 'POST', `/api/bands/${BAND}/invites`, { role: 'manager' });
    check('a manager can invite managers', inv3.status === 200);

    console.log('\n--- revoke');
    const invId = inv3.json.id as string;
    check('revoke a pending invite', (await call(owner, 'DELETE', `/api/bands/${BAND}/invites/${invId}`)).status === 200);
    const t3 = tokenOf(inv3.json.url);
    check('preview says revoked', (await call(null, 'GET', `/api/invites/${t3}`)).json.status === 'revoked');
    check('a revoked link is refused', (await call(cal, 'POST', `/api/invites/${t3}/accept`)).status === 410);

    console.log('\n--- one link, two people at once');
    await call(owner, 'DELETE', `${roster}/${cal.id}`);
    const outsider = await makeUser('dee');
    users.push(outsider);
    const inv4 = await call(owner, 'POST', `/api/bands/${BAND}/invites`, { role: 'member' });
    const t4 = tokenOf(inv4.json.url);
    const race = await Promise.all([cal, outsider].map((u) => call(u, 'POST', `/api/invites/${t4}/accept`)));
    check('exactly one of two simultaneous accepts wins', race.filter((r) => r.status === 200).length === 1,
      race.map((r) => r.status).join(','));

    console.log('\n--- leaving and transfer');
    const winner = race[0].status === 200 ? cal : outsider;
    check('a member can leave on their own', (await call(winner, 'DELETE', `${roster}/${winner.id}`)).status === 200);
    check('a manager can’t transfer ownership', (await call(bea, 'POST', `/api/bands/${BAND}/transfer`, { userId: bea.id })).status === 403);
    check('ownership only goes to a member', (await call(owner, 'POST', `/api/bands/${BAND}/transfer`, { userId: cal.id })).status === 400);
    check('owner transfers to bea', (await call(owner, 'POST', `/api/bands/${BAND}/transfer`, { userId: bea.id })).status === 200);
    const after = await call(bea, 'GET', roster);
    const roles = Object.fromEntries((after.json.members as { userId: string; role: string }[]).map((m) => [m.userId, m.role]));
    check('bea is owner, old owner is manager', roles[bea.id] === 'owner' && roles[owner.id] === 'manager', JSON.stringify(roles));

    console.log('\n--- members-only band in /api/data');
    const doc = `/api/data/${BAND}/band.json`;
    check('signed out → 401', (await call(null, 'GET', doc)).status === 401);
    check('signed-in non-member → 403', (await call(cal, 'GET', doc)).status === 403);
    check('member (new owner) → 200', (await call(bea, 'GET', doc)).status === 200);
    check('member (now manager) → 200', (await call(owner, 'GET', doc)).status === 200);
    const listed = async (u: User | null) =>
      JSON.stringify((await call(u, 'GET', '/api/data/registry.json')).json).includes(BAND);
    check('registry hides it from the signed-out', !(await listed(null)));
    check('registry hides it from non-members', !(await listed(cal)));
    check('registry lists it for members', await listed(bea));
    check('only the Owner may change visibility', (await call(owner, 'PUT', `/api/bands/${BAND}/visibility`, { visibility: 'public' })).status === 403);
    check('Owner makes it public', (await call(bea, 'PUT', `/api/bands/${BAND}/visibility`, { visibility: 'public' })).status === 200);
    check('now anyone can read it', (await call(null, 'GET', doc)).status === 200);
    check('Owner makes it members-only again', (await call(bea, 'PUT', `/api/bands/${BAND}/visibility`, { visibility: 'private' })).status === 200);
    check('signed out → 401 again', (await call(null, 'GET', doc)).status === 401);

    const [{ n }] = await sql`select count(*)::int n from audit_log a join band b on b.id = a.band_id where b.legacy_id = ${BAND}`;
    check('every change was audited', n >= 10, `${n} rows`);
  } finally {
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id = ${BAND}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id = ${BAND}`;
    await sql`delete from app_user where id = any(${ids})`;
    const [{ left }] = await sql`select count(*)::int left from app_user where email like ${TAG + '%'}`;
    console.log(`\ncleanup: ${left} test user(s) left`);
    await sql.end();
  }
  console.log(`===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
