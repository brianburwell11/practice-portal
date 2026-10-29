/**
 * End-to-end checks for shared song notes: everyone who can see a song sees
 * its notes and who wrote them; members (not guests) add them and edit or
 * delete their own; Managers and the Owner edit or delete anyone's.
 *
 *   npm run build:server && PORT=18565 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-notes.ts --url http://localhost:18565
 *
 * Run it on a scratch database with R2 blanked. Creates throwaway users and
 * a throwaway Public band, and deletes them in `finally`.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-notes.ts --url <server>   (DATABASE_URL from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vt-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

interface User { id: string; cookie: string }

async function makeUser(name: string, avatar: string | null = null): Promise<User> {
  const [u] = await sql`insert into app_user (email, display_name, avatar_url)
                        values (${`${TAG}-${name}@example.invalid`}, ${name}, ${avatar}) returning id`;
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
  return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}

const config = (id: string) => ({
  id, title: `Song ${id}`, artist: 'Verify', key: 'C', durationSeconds: 100, beatOffset: 0,
  stems: [{ id: 'mix', label: 'Mix', file: 'mix.opus', defaultVolume: 1, defaultPan: 0, color: '#fff' }],
  tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: { clickSound: 'click', accentPattern: [1, 0, 0, 0], subdivisions: 1 }, markers: [],
  tapMap: [{ time: 1, type: 'measure' }],
});

interface NoteView { id: string; time: number; text: string; author?: { id: string; name: string; avatarUrl: string | null } }

async function main(): Promise<void> {
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const manager = await makeUser('manager');
    const editor = await makeUser('editor');
    const member = await makeUser('mia', 'https://example.invalid/mia.png');
    const outsider = await makeUser('outsider');
    users.push(owner, manager, editor, member, outsider);
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
              values (${BAND}, ${BAND}, ${BAND}, ${colors}, ${owner.id}, 'public')`;
    for (const [u, role] of [[manager, 'manager'], [editor, 'editor'], [member, 'member']] as const) {
      await sql`insert into membership (user_id, band_id, role) select ${u.id}, id, ${role} from band where legacy_id = ${BAND}`;
    }
    check('setup: a song', (await call(owner.cookie, 'POST', `/api/bands/${BAND}/songs/s1/config`, config('s1'))).status === 200);
    const notesPath = `/api/bands/${BAND}/songs/s1/notes`;
    const read = async (cookie: string | null = null) =>
      ((await call(cookie, 'GET', `/api/data/${BAND}/songs/s1/notes.json`)).json.notes ?? []) as NoteView[];

    console.log('--- who may add a note');
    const added = await call(member.cookie, 'POST', notesPath, { time: 12.5, text: 'Watch the horns here' });
    const note = added.json.note as NoteView | undefined;
    check('a Member adds a note', added.status === 200 && note?.text === 'Watch the horns here', JSON.stringify(added.json));
    check('…signed as them, with their picture', note?.author?.id === member.id && note.author.name === 'mia'
      && note.author.avatarUrl === 'https://example.invalid/mia.png', JSON.stringify(note?.author));
    check('signed out → 401', (await call(null, 'POST', notesPath, { time: 1, text: 'x' })).status === 401);
    check('a signed-in outsider → 403', (await call(outsider.cookie, 'POST', notesPath, { time: 1, text: 'x' })).status === 403);
    const linkRes = await call(owner.cookie, 'POST', `/api/bands/${BAND}/guest-link`, {});
    const guestToken = new URL(String((linkRes.json.link as { url: string }).url)).searchParams.get('guest');
    const opened = await call(outsider.cookie, 'POST', `/api/guest/${guestToken}`);
    const guestCookie = opened.setCookie.find((c) => c.startsWith('pp_guest='))?.split(';')[0] ?? '';
    check('an outsider holding the guest link → still 403', (await call(`${outsider.cookie}; ${guestCookie}`, 'POST', notesPath, { time: 1, text: 'x' })).status === 403);
    check('an empty note → 400', (await call(member.cookie, 'POST', notesPath, { time: 1, text: '   ' })).status === 400);
    check('a note over 200 characters → 400', (await call(member.cookie, 'POST', notesPath, { time: 1, text: 'x'.repeat(201) })).status === 400);
    const editorNote = (await call(editor.cookie, 'POST', notesPath, { time: 20, text: 'Editor here' })).json.note as NoteView;
    check('an Editor adds one too', editorNote?.author?.id === editor.id);

    console.log('\n--- who sees them');
    const anon = await read();
    check('signed out, everyone sees every note', anon.length === 2, JSON.stringify(anon));
    check('…with the author’s name and picture', anon[0]?.author?.name === 'mia' && anon[0]?.author?.avatarUrl === 'https://example.invalid/mia.png');
    check('…and never an email address', !JSON.stringify(anon).includes('@example.invalid'), JSON.stringify(anon));

    console.log('\n--- editing and deleting');
    const id = note!.id;
    check('the author edits their own', (await call(member.cookie, 'PUT', `${notesPath}/${id}`, { time: 13, text: 'Horns come in' })).status === 200);
    check('an Editor can’t edit someone else’s → 403', (await call(editor.cookie, 'PUT', `${notesPath}/${id}`, { time: 13, text: 'mine now' })).status === 403);
    check('a Member can’t delete someone else’s → 403', (await call(member.cookie, 'DELETE', `${notesPath}/${editorNote.id}`)).status === 403);
    const byManager = await call(manager.cookie, 'PUT', `${notesPath}/${id}`, { time: 14, text: 'Horns come in, softly' });
    check('a Manager edits anyone’s', byManager.status === 200);
    check('…and it stays the author’s note', (byManager.json.note as NoteView)?.author?.id === member.id);
    check('the author deletes their own', (await call(member.cookie, 'DELETE', `${notesPath}/${id}`)).status === 200);
    check('…and it’s gone for everyone', !(await read()).some((n) => n.id === id));
    check('…and Undo brings it back', (await call(member.cookie, 'PUT', `${notesPath}/${id}`, { restore: true })).status === 200
      && (await read()).some((n) => n.id === id && n.text === 'Horns come in, softly'));
    check('the Owner deletes anyone’s', (await call(owner.cookie, 'DELETE', `${notesPath}/${editorNote.id}`)).status === 200);
    check('an unknown note → 404', (await call(owner.cookie, 'DELETE', `${notesPath}/n_nope`)).status === 404);

    console.log('\n--- notes from before notes had authors');
    await sql`update song set notes = jsonb_set(notes, '{notes}', (notes->'notes') || ${sql.json([{ id: 'old1', time: 50, text: 'Old band note' }])})
              where media_prefix = ${`${BAND}/songs/s1`}`;
    const old = (await read()).find((n) => n.id === 'old1');
    check('they still show, with no author', !!old && !old.author, JSON.stringify(old));
    check('a Member can’t edit one → 403', (await call(member.cookie, 'PUT', `${notesPath}/old1`, { time: 50, text: 'x' })).status === 403);
    check('a Manager can', (await call(manager.cookie, 'PUT', `${notesPath}/old1`, { time: 50, text: 'Old band note, edited' })).status === 200);

    console.log('\n--- many at once');
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      call([member, editor, manager, owner][i % 4].cookie, 'POST', notesPath, { time: 60 + i, text: `burst ${i}` })));
    check('8 notes added at the same moment all land', burst.every((r) => r.status === 200)
      && (await read()).filter((n) => n.text.startsWith('burst')).length === 8, burst.map((r) => r.status).join(','));
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
