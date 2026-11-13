/**
 * End-to-end checks for mixer templates: Owners, Managers and Editors (who
 * hold `song.audio.write`) list, save, replace, star and delete them; Members
 * and outsiders can't; one band never sees or touches another's.
 *
 *   npm run build:server && PORT=18565 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-mixer-templates.ts --url http://localhost:18565
 *
 * Run it on a scratch database with R2 blanked (refuses a Neon URL). Creates
 * throwaway users and bands, and deletes them in `finally`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-mixer-templates.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}
if (process.env.DATABASE_URL.includes('neon.tech')) {
  console.error('Refusing to run against Neon: it is shared with production. Use a scratch database.');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vt-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const OTHER = `${TAG}-other`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
}

interface User { id: string; cookie: string }

async function makeUser(name: string): Promise<User> {
  const [u] = await sql`insert into app_user (email, display_name)
                        values (${`${TAG}-${name}@example.invalid`}, ${name}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into session (token_hash, user_id, expires_at)
            values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, now() + interval '10 minutes')`;
  return { id: u.id as string, cookie: `pp_session=${token}` };
}

async function call(cookie: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== 'GET' ? { origin: base!, 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json };
}

interface Template { id: string; name: string; isDefault: boolean; stems: unknown[]; groups: unknown[] }

const mix = (name: string, kick = 1) => ({
  name,
  stems: [{ name: 'Kick', volume: kick, pan: 0 }, { name: 'Bass', volume: 0.8, pan: -0.2 }],
  groups: [{ name: 'Drums', volume: 1.1 }],
});

async function main(): Promise<void> {
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');
    users.push(owner, editor, member, outsider);
    const colors = '{"accent":"#111","background":"#000","text":"#fff"}';
    for (const b of [BAND, OTHER]) {
      await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
                values (${b}, ${b}, ${b}, ${colors}, ${owner.id}, 'public')`;
    }
    for (const [u, role] of [[editor, 'editor'], [member, 'member']] as const) {
      await sql`insert into membership (user_id, band_id, role) select ${u.id}, id, ${role} from band where legacy_id = ${BAND}`;
    }
    const path = `/api/bands/${BAND}/mixer-templates`;
    const list = async (cookie = owner.cookie, band = BAND) =>
      ((await call(cookie, 'GET', `/api/bands/${band}/mixer-templates`)).json.templates ?? []) as Template[];

    console.log('--- who may use them');
    check('an empty band lists none', (await list()).length === 0);
    check('signed out → 401', (await call(null, 'GET', path)).status === 401);
    check('a Member → 403', (await call(member.cookie, 'GET', path)).status === 403);
    check('an outsider → 403', (await call(outsider.cookie, 'GET', path)).status === 403);
    check('a Member can’t save → 403', (await call(member.cookie, 'PUT', `${path}/${randomUUID()}`, mix('Nope'))).status === 403);

    console.log('\n--- saving');
    const rockId = randomUUID();
    const saved = await call(editor.cookie, 'PUT', `${path}/${rockId}`, mix('Rock'));
    check('an Editor saves one', saved.status === 200 && (saved.json.template as Template)?.name === 'Rock', JSON.stringify(saved.json));
    const rock = (await list()).find((t) => t.id === rockId);
    check('…it lists with its tracks and stacks', rock?.stems.length === 2 && rock.groups.length === 1 && rock.isDefault === false, JSON.stringify(rock));
    check('the same name in another case, new id → 409', (await call(owner.cookie, 'PUT', `${path}/${randomUUID()}`, mix('ROCK'))).status === 409);
    check('replacing by id works', (await call(owner.cookie, 'PUT', `${path}/${rockId}`, mix('Rock', 0.5))).status === 200
      && ((await list()).find((t) => t.id === rockId)?.stems[0] as { volume: number })?.volume === 0.5);
    check('an empty name → 400', (await call(owner.cookie, 'PUT', `${path}/${randomUUID()}`, mix('  '))).status === 400);
    check('a gain over 1.5 → 400', (await call(owner.cookie, 'PUT', `${path}/${randomUUID()}`, mix('Loud', 2))).status === 400);
    check('a bad id → 400', (await call(owner.cookie, 'PUT', `${path}/not-a-uuid`, mix('Bad'))).status === 400);

    console.log('\n--- the default');
    const jazzId = randomUUID();
    await call(owner.cookie, 'PUT', `${path}/${jazzId}`, mix('Jazz'));
    check('star Rock', (await call(owner.cookie, 'POST', `${path}/${rockId}/default`, { isDefault: true })).status === 200);
    check('star Jazz', (await call(editor.cookie, 'POST', `${path}/${jazzId}/default`, { isDefault: true })).status === 200);
    const stars = (await list()).filter((t) => t.isDefault).map((t) => t.name);
    check('…only Jazz is the default', stars.length === 1 && stars[0] === 'Jazz', stars.join(','));
    check('unstar Jazz', (await call(owner.cookie, 'POST', `${path}/${jazzId}/default`, { isDefault: false })).status === 200
      && (await list()).every((t) => !t.isDefault));

    console.log('\n--- bands stay apart');
    check('the other band lists none', (await list(owner.cookie, OTHER)).length === 0);
    check('the other band can’t overwrite this one’s → 404',
      (await call(owner.cookie, 'PUT', `/api/bands/${OTHER}/mixer-templates/${rockId}`, mix('Stolen'))).status === 404);
    check('…or delete it → 404', (await call(owner.cookie, 'DELETE', `/api/bands/${OTHER}/mixer-templates/${rockId}`)).status === 404);
    check('the other band may use the name Rock', (await call(owner.cookie, 'PUT', `/api/bands/${OTHER}/mixer-templates/${randomUUID()}`, mix('Rock'))).status === 200);

    console.log('\n--- deleting');
    check('a Member can’t delete → 403', (await call(member.cookie, 'DELETE', `${path}/${rockId}`)).status === 403);
    check('an Editor deletes', (await call(editor.cookie, 'DELETE', `${path}/${rockId}`)).status === 200);
    check('…and it’s gone', !(await list()).some((t) => t.id === rockId));
    const audits = await sql`select action from audit_log where band_id = (select id from band where legacy_id = ${BAND})
                              and action like 'mixer.template.%'`;
    check('writes are audited', audits.length >= 6, String(audits.length));
  } finally {
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    await sql`delete from app_user where id = any(${ids})`;
    await sql.end();
  }
  console.log(`\n===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
