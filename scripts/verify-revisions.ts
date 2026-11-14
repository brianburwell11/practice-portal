/**
 * End-to-end checks for document revisions: reads carry `X-Doc-Rev`, saves
 * bump it, and a save based on an older revision (`?baseRev=`) is refused
 * with 409 and the current copy. Saves without `baseRev` still go through.
 *
 *   npm run build:server && PORT=18565 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-revisions.ts --url http://localhost:18565
 *
 * Run it on a scratch database with R2 blanked (refuses a Neon URL). Creates
 * a throwaway user and band, and deletes them in `finally`.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-revisions.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}
if (process.env.DATABASE_URL.includes('neon.tech')) {
  console.error('Refusing to run against Neon: it is shared with production. Use a scratch database.');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vt-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
}

async function makeUser(name: string): Promise<{ id: string; cookie: string }> {
  const [u] = await sql`insert into app_user (email, display_name)
                        values (${`${TAG}-${name}@example.invalid`}, ${name}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into session (token_hash, user_id, expires_at)
            values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, now() + interval '10 minutes')`;
  return { id: u.id as string, cookie: `pp_session=${token}` };
}

let cookie = '';
async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(method !== 'GET' ? { origin: base!, 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, rev: res.headers.get('X-Doc-Rev') };
}

const config = (id: string, title = `Song ${id}`) => ({
  id, title, artist: 'Verify', key: 'C', durationSeconds: 100, beatOffset: 0,
  stems: [{ id: 'mix', label: 'Mix', file: 'mix.opus', defaultVolume: 1, defaultPan: 0, color: '#fff' }],
  tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: { clickSound: 'click', accentPattern: [1, 0, 0, 0], subdivisions: 1 }, markers: [],
});
const lyrics = (text: string) => ({ lines: [{ text, time: 1 }] });

async function main(): Promise<void> {
  let ownerId = '';
  try {
    const owner = await makeUser('owner');
    ownerId = owner.id;
    cookie = owner.cookie;
    const colors = '{"accent":"#111","background":"#000","text":"#fff"}';
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
              values (${BAND}, ${BAND}, ${BAND}, ${colors}, ${owner.id}, 'public')`;
    const song = `/api/bands/${BAND}/songs/s1`;
    const data = `/api/data/${BAND}/songs/s1`;

    console.log('--- config');
    check('create a song without baseRev', (await call('POST', `${song}/config`, config('s1'))).status === 200);
    const read1 = await call('GET', `${data}/config.json`);
    check('a read carries X-Doc-Rev', read1.rev === '1', String(read1.rev));
    const a = await call('POST', `${song}/config?baseRev=1`, config('s1', 'Mine'));
    check('a save on the current rev goes through and returns the new rev', a.status === 200 && a.json.rev === 2, JSON.stringify(a.json));
    const stale = await call('POST', `${song}/config?baseRev=1`, config('s1', 'Stale'));
    check('a save on an older rev → 409', stale.status === 409, String(stale.status));
    check('…with the current copy and its rev', (stale.json.current as { title?: string })?.title === 'Mine' && stale.json.rev === 2, JSON.stringify(stale.json).slice(0, 200));
    check('…and nothing was written', (await call('GET', `${data}/config.json`)).json.title === 'Mine');
    check('a save without baseRev still goes through', (await call('POST', `${song}/config`, config('s1', 'Unchecked'))).status === 200);
    check('…and bumps the rev', (await call('GET', `${data}/config.json`)).rev === '3');
    check('a bad baseRev → 400', (await call('POST', `${song}/config?baseRev=abc`, config('s1'))).status === 400);

    console.log('\n--- lyrics: two editors');
    check('no lyrics yet: a save on rev 0 goes through', (await call('POST', `${song}/lyrics?baseRev=0`, lyrics('first'))).status === 200);
    check('a second save on rev 0 → 409 (someone created them meanwhile)',
      (await call('POST', `${song}/lyrics?baseRev=0`, lyrics('second'))).status === 409);
    const both = (await call('GET', `${data}/lyrics.json`)).rev;
    const one = await call('POST', `${song}/lyrics?baseRev=${both}`, lyrics('editor one'));
    const two = await call('POST', `${song}/lyrics?baseRev=${both}`, lyrics('editor two'));
    check('editor one saves', one.status === 200);
    check('editor two, on the same copy, → 409 with editor one’s text', two.status === 409
      && JSON.stringify(two.json.current).includes('editor one'), JSON.stringify(two.json).slice(0, 200));
    check('lyrics and config revs are separate', (await call('GET', `${data}/config.json`)).rev === '3');

    console.log('\n--- chords');
    check('chords save on rev 0', (await call('POST', `${song}/chords?baseRev=0`, { chords: [] })).status === 200);
    check('stale chords → 409', (await call('POST', `${song}/chords?baseRev=0`, { chords: [] })).status === 409);

    console.log('\n--- setlists');
    const setlist = { id: 'sl1', name: 'Gig', entries: [{ type: 'song', songId: 's1' }] };
    check('create a setlist', (await call('POST', `/api/bands/${BAND}/setlists/sl1`, setlist)).status === 200);
    const slRev = (await call('GET', `/api/data/${BAND}/setlists/sl1.json`)).rev;
    check('a setlist read carries X-Doc-Rev', slRev === '1', String(slRev));
    check('save on rev 1', (await call('POST', `/api/bands/${BAND}/setlists/sl1?baseRev=1`, { ...setlist, name: 'Gig 2' })).status === 200);
    check('stale setlist save → 409', (await call('POST', `/api/bands/${BAND}/setlists/sl1?baseRev=1`, setlist)).status === 409);
  } finally {
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = ${ownerId || null}`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    if (ownerId) await sql`delete from app_user where id = ${ownerId}`;
    await sql.end();
  }
  console.log(`\n===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
