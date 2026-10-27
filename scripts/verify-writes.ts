/**
 * Phase 6's exit check, end to end: who may write what, enforced through a
 * running server, with Postgres written first and R2 copied after commit.
 *
 *   npm run build:server && PORT=18558 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-writes.ts --url http://localhost:18558
 *
 * Needs a server with DATABASE_URL and R2 credentials. Creates throwaway
 * users and two throwaway Members-only bands (so nothing shows on the public
 * site), writes real R2 objects under their prefixes, and deletes all of it
 * — rows, audit entries and R2 objects — in `finally`.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { r2DeleteKey, r2ListKeys } from '../server/core/r2';

dotenv.config();

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
const r2 = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL || !r2) {
  console.error('Usage: verify-writes.ts --url <server>   (DATABASE_URL, R2_PUBLIC_URL and R2 credentials from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vw-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const OTHER = `${TAG}-other`;

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
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json };
}

/** The R2 copy, read through the public URL as the GitHub Pages build would. */
async function r2Doc(key: string): Promise<unknown | null> {
  const res = await fetch(`${r2}/${key}?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

async function pgConfig(songId: string): Promise<Record<string, unknown> | null> {
  const [row] = await sql`select config from song s join band b on b.id = s.band_id
                          where b.legacy_id = ${BAND} and s.media_prefix = ${`${BAND}/songs/${songId}`}`;
  return (row?.config as Record<string, unknown>) ?? null;
}

const config = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Song ${id}`, artist: 'Verify', key: 'C', durationSeconds: 100, beatOffset: 0,
  stems: [{ id: 'mix', label: 'Mix', file: 'mix.opus', defaultVolume: 1, defaultPan: 0, color: '#fff' }],
  tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: { clickSound: 'click', accentPattern: [1, 0, 0, 0], subdivisions: 1 }, markers: [],
  tapMap: [{ time: 1, type: 'measure' }], ...extra,
});

async function main(): Promise<void> {
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');
    users.push(owner, editor, member, outsider);
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    for (const b of [BAND, OTHER]) {
      await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
                values (${b}, ${b}, ${b}, ${colors}, ${owner.id}, 'private')`;
    }
    await sql`insert into membership (user_id, band_id, role)
              select ${editor.id}, id, 'editor' from band where legacy_id = ${BAND}`;
    await sql`insert into membership (user_id, band_id, role)
              select ${member.id}, id, 'member' from band where legacy_id = ${BAND}`;
    const cfg = (song: string) => `/api/bands/${BAND}/songs/${song}/config`;

    console.log('--- who may create a song');
    check('signed out → 401', (await call(null, 'POST', cfg('s1'), config('s1'))).status === 401);
    check('outsider → 403', (await call(outsider, 'POST', cfg('s1'), config('s1'))).status === 403);
    check('member → 403', (await call(member, 'POST', cfg('s1'), config('s1'))).status === 403);
    check('nothing was written by refused requests', (await pgConfig('s1')) === null);
    const created = await call(editor, 'POST', cfg('s1'), config('s1'));
    check('editor creates a song (song.create)', created.status === 200, JSON.stringify(created.json));
    check('Postgres has it', (await pgConfig('s1'))?.title === 'Song s1');
    check('R2 got the copy after commit', (await r2Doc(`${BAND}/songs/s1/config.json`) as { title?: string } | null)?.title === 'Song s1');

    console.log('\n--- editing: content yes, timing no');
    check('editor changes the title', (await call(editor, 'POST', cfg('s1'), config('s1', { title: 'Retitled' }))).status === 200);
    const timing = await call(editor, 'POST', cfg('s1'), config('s1', { title: 'Retitled', tapMap: [{ time: 2, type: 'measure' }] }));
    check('editor is refused a tapMap change', timing.status === 403 && String(timing.json.error).includes('song.timing.write'), JSON.stringify(timing.json));
    check('…and Postgres kept the old tapMap', JSON.stringify((await pgConfig('s1'))?.tapMap) === JSON.stringify([{ time: 1, type: 'measure' }]));
    check('…and so did R2', JSON.stringify((await r2Doc(`${BAND}/songs/s1/config.json`) as { tapMap?: unknown })?.tapMap) === JSON.stringify([{ time: 1, type: 'measure' }]));
    check('owner may change timing', (await call(owner, 'POST', cfg('s1'), config('s1', { title: 'Retitled', tapMap: [{ time: 2, type: 'measure' }] }))).status === 200);
    check('member is refused lyrics', (await call(member, 'POST', `/api/bands/${BAND}/songs/s1/lyrics`, { lines: [{ text: 'la', time: 1 }] })).status === 403);
    check('editor saves lyrics', (await call(editor, 'POST', `/api/bands/${BAND}/songs/s1/lyrics`, { lines: [{ text: 'la', time: 1 }] })).status === 200);

    console.log('\n--- discography, setlists, band settings');
    const disc = await call(editor, 'POST', `/api/bands/${BAND}/songs/discography`,
      { id: 's1', title: 'Retitled', artist: 'Verify', audioBasePath: `${r2}/${BAND}/songs/s1` });
    check('editor adds the discography entry for the song just saved (wizard order)', disc.status === 200, JSON.stringify(disc.json));
    const clash = await call(editor, 'POST', `/api/bands/${BAND}/songs/discography`,
      { id: 's1', title: 'A Different Song', artist: 'Someone', audioBasePath: `${r2}/${BAND}/songs/s1` });
    check('a different song under the same id → 409', clash.status === 409, JSON.stringify(clash.json));
    const setlist = { id: 'SL1', slug: 'gig', name: 'Gig', entries: [{ type: 'song', songId: 's1' }] };
    check('member is refused a setlist', (await call(member, 'POST', `/api/bands/${BAND}/setlists/SL1`, setlist)).status === 403);
    check('editor saves a setlist (setlist.write)', (await call(editor, 'POST', `/api/bands/${BAND}/setlists/SL1`, setlist)).status === 200);
    check('setlist index rebuilt, copied to R2', JSON.stringify(await r2Doc(`${BAND}/setlists/index.json`)).includes('"SL1"'));
    const band = { id: BAND, name: 'Renamed Band', route: BAND, colors: JSON.parse(colors) };
    check('editor is refused band settings', (await call(editor, 'PUT', `/api/bands/${BAND}`, band)).status === 403);
    check('owner changes band settings', (await call(owner, 'PUT', `/api/bands/${BAND}`, band)).status === 200);
    check('a non-admin can’t create a band', (await call(owner, 'PUT', `/api/bands/${TAG}-new`, { ...band, id: `${TAG}-new`, route: `${TAG}-new` })).status === 403);

    console.log('\n--- one band can’t reach another');
    check('editor of one band can’t write to another', (await call(editor, 'POST', `/api/bands/${OTHER}/songs/x/config`, config('x'))).status === 403);

    console.log('\n--- rename keeps lyrics (owner)');
    const renamed = await call(owner, 'POST', `/api/bands/${BAND}/songs/s1/rename`, { newId: 's2' });
    check('rename s1 → s2', renamed.status === 200, JSON.stringify(renamed.json));
    check('old id gone from Postgres', (await pgConfig('s1')) === null);
    check('new id in Postgres with its own id', (await pgConfig('s2'))?.id === 's2');
    const [ly] = await sql`select lyrics from song s join band b on b.id = s.band_id where b.legacy_id = ${BAND} and s.media_prefix = ${`${BAND}/songs/s2`}`;
    check('lyrics followed the rename', JSON.stringify(ly?.lyrics).includes('"la"'));
    check('setlist follows the new id', JSON.stringify(await r2Doc(`${BAND}/setlists/SL1.json`)).includes('"s2"'));
    check('old R2 config deleted after commit', (await r2Doc(`${BAND}/songs/s1/config.json`)) === null);

    console.log('\n--- delete: editors can’t, owners can');
    check('editor is refused deleting a song', (await call(editor, 'DELETE', `/api/bands/${BAND}/songs/s2`)).status === 403);
    check('…and it still exists', (await pgConfig('s2')) !== null);
    check('owner deletes the song', (await call(owner, 'DELETE', `/api/bands/${BAND}/songs/s2`)).status === 200);
    check('gone from Postgres', (await pgConfig('s2')) === null);
    check('gone from R2', (await r2Doc(`${BAND}/songs/s2/config.json`)) === null);
    check('setlist no longer lists it', !JSON.stringify(await r2Doc(`${BAND}/setlists/SL1.json`)).includes('"s2"'));

    const audit = await sql`select action from audit_log a join band b on b.id = a.band_id where b.legacy_id = ${BAND}`;
    const actions = new Set(audit.map((r) => r.action as string));
    check('writes are audited', ['song.config.write', 'song.lyrics.write', 'setlist.write', 'song.rename', 'song.delete', 'band.settings.write']
      .every((a) => actions.has(a)), [...actions].join(', '));
    // Three config saves succeeded (create, retitle, owner's timing edit); four were refused.
    const configWrites = audit.filter((r) => r.action === 'song.config.write').length;
    check('exactly one audit row per successful save, none for refused ones', configWrites === 3, `${configWrites} rows`);
  } finally {
    for (const b of [BAND, OTHER, `${TAG}-new`]) {
      for (const key of await r2ListKeys(`${b}/`)) await r2DeleteKey(key);
    }
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    await sql`delete from app_user where id = any(${ids})`;
    const [{ left }] = await sql`select count(*)::int left from app_user where email like ${TAG + '%'}`;
    const r2Left = (await r2ListKeys(`${TAG}`)).length;
    console.log(`\ncleanup: ${left} test user(s), ${r2Left} R2 object(s) left`);
    await sql.end();
  }
  console.log(`===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
