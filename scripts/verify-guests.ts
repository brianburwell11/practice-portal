/**
 * Phase 10's exit check: guest links for subs, end to end through a running
 * server and Postgres.
 *
 *   npm run build:server && PORT=18558 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-guests.ts --url http://localhost:18558
 *
 * Who may manage a band's link, what it opens (its Members-only band,
 * read-only, and nothing else), and that expiry, reset and turning it off each
 * end access on the next request. Creates throwaway users and two throwaway Members-only bands, and
 * deletes all of it — rows, audit entries and R2 copies — in `finally`.
 *
 * Without R2 credentials (against a scratch Postgres, say) the server's R2
 * copies fail harmlessly and cleanup leaves R2 alone.
 */
import { createHash, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { getR2Client, r2DeleteKey, r2ListKeys } from '../server/core/r2';
import { syncRegistry } from './sync-r2-registry';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: verify-guests.ts --url <server>   (DATABASE_URL and R2 credentials from .env)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vg-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const OTHER = `${TAG}-other`;
/** A third Members-only band that never has a guest link. */
const THIRD = `${TAG}-third`;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
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

/** `cookie` is the whole Cookie header: a session, a guest cookie, both, or neither. */
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
  return { status: res.status, json, setCookie: res.headers.getSetCookie(), cacheControl: res.headers.get('cache-control') };
}

/** `pp_guest=<value>` from a response's Set-Cookie, or null. */
function guestCookie(setCookie: string[]): string | null {
  const c = setCookie.find((s) => s.startsWith('pp_guest='));
  if (!c) return null;
  return `pp_guest=${decodeURIComponent(c.slice('pp_guest='.length).split(';')[0])}`;
}

/** The token in a guest link, `<origin>/<band>?guest=<token>`. */
const tokenOf = (url: unknown) => {
  try { return new URL(String(url)).searchParams.get('guest') ?? ''; } catch { return ''; }
};

const config = (id: string) => ({
  id, title: `Song ${id}`, artist: 'Verify', key: 'C', durationSeconds: 100, beatOffset: 0,
  stems: [{ id: 'mix', label: 'Mix', file: 'mix.opus', defaultVolume: 1, defaultPan: 0, color: '#fff' }],
  tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: { clickSound: 'click', accentPattern: [1, 0, 0, 0], subdivisions: 1 }, markers: [],
  tapMap: [{ time: 1, type: 'measure' }],
});

async function main(): Promise<void> {
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const manager = await makeUser('manager');
    const editor = await makeUser('editor');
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');
    users.push(owner, manager, editor, member, outsider);
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    for (const b of [BAND, OTHER, THIRD]) {
      await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
                values (${b}, ${b}, ${b}, ${colors}, ${owner.id}, 'private')`;
    }
    for (const [u, role] of [[manager, 'manager'], [editor, 'editor'], [member, 'member']] as const) {
      await sql`insert into membership (user_id, band_id, role) select ${u.id}, id, ${role} from band where legacy_id = ${BAND}`;
    }
    check('setup: a song in the band', (await call(owner.cookie, 'POST', `/api/bands/${BAND}/songs/s1/config`, config('s1'))).status === 200);
    check('setup: a setlist in the band', (await call(owner.cookie, 'POST', `/api/bands/${BAND}/setlists/SL1`,
      { id: 'SL1', slug: 'friday', name: 'Friday', entries: [{ type: 'song', songId: 's1' }] })).status === 200);
    for (const b of [OTHER, THIRD]) {
      // In order: lyrics and notes belong to a song that has to exist first.
      const statuses = [];
      for (const [path, body] of [
        ['songs/x/config', config('x')],
        ['songs/x/lyrics', { lines: [{ text: 'secret', time: 1 }] }],
        ['songs/x/notes', { time: 1, text: 'secret' }],
        ['setlists/SLX', { id: 'SLX', slug: 'saturday', name: 'Saturday', entries: [{ type: 'song', songId: 'x' }] }],
      ] as const) {
        statuses.push((await call(owner.cookie, 'POST', `/api/bands/${b}/${path}`, body)).status);
      }
      check(`setup: ${b} has a song, lyrics, notes and a setlist`, statuses.every((st) => st === 200), statuses.join(', '));
    }

    const path = `/api/bands/${BAND}/guest-link`;
    type Link = { url: string; expiresAt: string | null; expired: boolean; lastUsedAt: string | null } | null;
    const linkOf = (r: { json: Record<string, unknown> }) => r.json.link as Link;

    console.log('\n--- who may manage the link');
    check('it starts off', (await call(owner.cookie, 'GET', path)).json.link === null);
    check('signed out → 401', (await call(null, 'POST', path, {})).status === 401);
    check('member → 403', (await call(member.cookie, 'POST', path, {})).status === 403);
    check('editor → 403', (await call(editor.cookie, 'POST', path, {})).status === 403);
    check('outsider → 403', (await call(outsider.cookie, 'POST', path, {})).status === 403);
    check('editor can’t see it', (await call(editor.cookie, 'GET', path)).status === 403);
    check('an expiry in the past → 400', (await call(manager.cookie, 'POST', path, { expiresAt: '2020-01-01T00:00:00Z' })).status === 400);
    check('a nonsense expiry → 400', (await call(manager.cookie, 'POST', path, { expiresAt: 'soon' })).status === 400);
    const on = await call(manager.cookie, 'POST', path, {});
    const first = linkOf(on);
    check('manager turns it on', on.status === 200 && tokenOf(first?.url) !== '', JSON.stringify(on.json));
    check('the token is 16 letters and digits', /^[A-Za-z0-9]{16}$/.test(tokenOf(first?.url)), tokenOf(first?.url));
    check('the link is the band’s own address with ?guest=', !!first && new URL(first.url).pathname === `/${BAND}`, first?.url);
    check('no expiry by default', first?.expiresAt === null);
    check('owner sees the same link again later', linkOf(await call(owner.cookie, 'GET', path))?.url === first?.url);
    const [stored] = await sql`select token_hash from grant_link g join band b on b.id = g.band_id
                               where b.legacy_id = ${BAND} and g.revoked_at is null`;
    check('looked up by the token’s hash', stored?.token_hash === createHash('sha256').update(tokenOf(first?.url)).digest('hex'));

    console.log('\n--- opening it');
    check('signed out, the band is closed (baseline)', (await call(null, 'GET', `/api/data/${BAND}/band.json`)).status === 401);
    check('an unknown token → 404', (await call(null, 'POST', `/api/guest/${randomBytes(32).toString('base64url')}`)).status === 404);
    const opened = await call(null, 'POST', `/api/guest/${tokenOf(first?.url)}`);
    const guest = guestCookie(opened.setCookie);
    check('opening sets pp_guest', opened.status === 200 && !!guest, JSON.stringify(opened));
    check('…and says which band', (opened.json.band as { id?: string })?.id === BAND, JSON.stringify(opened.json));
    check('the cookie is httpOnly', opened.setCookie.some((c) => c.startsWith('pp_guest=') && /HttpOnly/i.test(c)));
    const other = await call(owner.cookie, 'POST', `/api/bands/${OTHER}/guest-link`, {});
    const sameDevice = guestCookie((await call(guest, 'POST', `/api/guest/${tokenOf(linkOf(other)?.url)}`)).setCookie);
    check('one device can hold two bands’ links', !!sameDevice && sameDevice.includes(tokenOf(first?.url)) && sameDevice.includes(tokenOf(linkOf(other)?.url)));
    // The other band's link stays on until the cross-band checks below: a band
    // having a live link must not open it to holders of some other band's link.

    console.log('\n--- what a guest can read');
    const registry = await call(guest, 'GET', '/api/data/registry.json');
    const ids = ((registry.json.bands ?? []) as { id: string }[]).map((x) => x.id);
    check('the registry lists the band', ids.includes(BAND));
    check('…but not the other Members-only band', !ids.includes(OTHER));
    const bandDoc = await call(guest, 'GET', `/api/data/${BAND}/band.json`);
    check('band.json', bandDoc.status === 200);
    check('…marked private to caches', bandDoc.cacheControl?.includes('private') === true, String(bandDoc.cacheControl));
    check('discography', (await call(guest, 'GET', `/api/data/${BAND}/songs/discography.json`)).status === 200);
    check('a song config', (await call(guest, 'GET', `/api/data/${BAND}/songs/s1/config.json`)).status === 200);
    check('the setlist index', (await call(guest, 'GET', `/api/data/${BAND}/setlists/index.json`)).status === 200);
    check('a setlist', (await call(guest, 'GET', `/api/data/${BAND}/setlists/SL1.json`)).status === 200);
    check('the other band → 401', (await call(guest, 'GET', `/api/data/${OTHER}/band.json`)).status === 401);
    check('the other band’s song → 401', (await call(guest, 'GET', `/api/data/${OTHER}/songs/x/config.json`)).status === 401);
    const me = await call(guest, 'GET', '/api/me');
    const meGuest = (me.json.guest ?? []) as { band: { id: string }; expiresAt: string | null }[];
    check('/api/me: no user, the band as a guest', me.json.user === null && meGuest.length === 1 && meGuest[0].band.id === BAND, JSON.stringify(me.json));
    check('/api/me never shows the token', !JSON.stringify(me.json).includes(tokenOf(first?.url)));
    check('last used is recorded', linkOf(await call(manager.cookie, 'GET', path))?.lastUsedAt !== null);
    const both = `${outsider.cookie}; ${guest}`;
    check('a signed-in non-member holding the link can read too', (await call(both, 'GET', `/api/data/${BAND}/songs/s1/config.json`)).status === 200);

    console.log('\n--- what a guest can’t do');
    check('save a song config → 401', (await call(guest, 'POST', `/api/bands/${BAND}/songs/s1/config`, { ...config('s1'), title: 'Hacked' })).status === 401);
    check('save a setlist → 401', (await call(guest, 'POST', `/api/bands/${BAND}/setlists/SL2`, { id: 'SL2', slug: 'x', name: 'X', entries: [] })).status === 401);
    check('see the guest link → 401', (await call(guest, 'GET', path)).status === 401);
    check('reset the guest link → 401', (await call(guest, 'POST', path, {})).status === 401);
    check('see the roster → 401', (await call(guest, 'GET', `/api/bands/${BAND}/members`)).status === 401);
    check('the outsider still can’t write with a link', (await call(both, 'POST', `/api/bands/${BAND}/songs/s1/config`, { ...config('s1'), title: 'Hacked' })).status === 403);
    const [title] = await sql`select config->>'title' t from song s join band b on b.id = s.band_id where b.legacy_id = ${BAND}`;
    check('…and nothing changed', title?.t === 'Song s1');

    console.log('\n--- one band’s link opens that band and no other');
    const docs = (b: string) => [
      `${b}/band.json`, `${b}/songs/discography.json`, `${b}/songs/x/config.json`, `${b}/songs/x/lyrics.json`,
      `${b}/songs/x/notes.json`, `${b}/setlists/index.json`, `${b}/setlists/SLX.json`,
    ];
    for (const b of [OTHER, THIRD]) {
      const label = b === OTHER ? 'other band (has its own live link)' : 'third band (never had a link)';
      const exist = await Promise.all(docs(b).map((k) => call(owner.cookie, 'GET', `/api/data/${k}`)));
      check(`${label}: all ${docs(b).length} documents exist (owner reads them)`, exist.every((r) => r.status === 200),
        exist.map((r, i) => `${docs(b)[i]} ${r.status}`).join(', '));
      const asGuest = await Promise.all(docs(b).map((k) => call(guest, 'GET', `/api/data/${k}`)));
      check(`${label}: every document refuses the first band’s guest (401)`, asGuest.every((r) => r.status === 401),
        asGuest.map((r, i) => `${docs(b)[i]} ${r.status}`).join(', '));
      check(`${label}: …and nothing of it leaks in an error`, asGuest.every((r) => !JSON.stringify(r.json).includes('secret')));
      const signedIn = await Promise.all(docs(b).map((k) => call(both, 'GET', `/api/data/${k}`)));
      check(`${label}: a signed-in non-member with the first band’s link → 403`, signedIn.every((r) => r.status === 403),
        signedIn.map((r, i) => `${docs(b)[i]} ${r.status}`).join(', '));
      const manage = await Promise.all([
        call(guest, 'GET', `/api/bands/${b}/guest-link`),
        call(guest, 'POST', `/api/bands/${b}/guest-link`, {}),
        call(guest, 'GET', `/api/bands/${b}/members`),
        call(guest, 'POST', `/api/bands/${b}/songs/x/config`, { ...config('x'), title: 'Hacked' }),
        call(guest, 'POST', `/api/bands/${b}/setlists/SLX`, { id: 'SLX', slug: 'saturday', name: 'Hacked', entries: [] }),
        call(guest, 'DELETE', `/api/bands/${b}/songs/x`),
      ]);
      check(`${label}: its link, roster and writes all refuse the guest (401)`, manage.every((r) => r.status === 401),
        manage.map((r) => r.status).join(', '));
    }
    const guestRegistry = ((await call(guest, 'GET', '/api/data/registry.json')).json.bands as { id: string }[]).map((x) => x.id);
    check('the registry shows the guest only the first band', guestRegistry.includes(BAND) && !guestRegistry.includes(OTHER) && !guestRegistry.includes(THIRD), guestRegistry.join(', '));
    const meBands = ((await call(guest, 'GET', '/api/me')).json.guest as { band: { id: string } }[]).map((g) => g.band.id);
    check('/api/me lists only the first band', meBands.length === 1 && meBands[0] === BAND, meBands.join(', '));
    check('a forged cookie of junk tokens opens nothing', (await call(`pp_guest=${'A'.repeat(16)}.${'b1'.repeat(10)}`, 'GET', `/api/data/${OTHER}/band.json`)).status === 401);
    const twoRegistry = ((await call(sameDevice, 'GET', '/api/data/registry.json')).json.bands as { id: string }[]).map((x) => x.id);
    check('holding both links: both bands, still not the third', twoRegistry.includes(BAND) && twoRegistry.includes(OTHER) && !twoRegistry.includes(THIRD), twoRegistry.join(', '));
    check('…the third band’s song is still refused', (await call(sameDevice, 'GET', `/api/data/${THIRD}/songs/x/config.json`)).status === 401);
    check('turning off the other band’s link', (await call(owner.cookie, 'DELETE', `/api/bands/${OTHER}/guest-link`)).status === 200);
    check('…closes the other band to that device', (await call(sameDevice, 'GET', `/api/data/${OTHER}/band.json`)).status === 401);
    check('…and leaves the first band open', (await call(sameDevice, 'GET', `/api/data/${BAND}/band.json`)).status === 200);
    const titles = await sql`select config->>'title' t from song s join band b on b.id = s.band_id where b.legacy_id in (${OTHER}, ${THIRD})`;
    check('nothing in either band changed', titles.length === 2 && titles.every((r) => r.t === 'Song x'));

    console.log('\n--- expiry');
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const dated = linkOf(await call(manager.cookie, 'PUT', path, { expiresAt: soon }));
    check('manager sets an expiry', dated?.expiresAt !== null && new Date(dated!.expiresAt!).toISOString() === soon);
    check('…without changing the link', dated?.url === first?.url);
    check('the guest still reads', (await call(guest, 'GET', `/api/data/${BAND}/band.json`)).status === 200);
    await sql`update grant_link set expires_at = now() - interval '1 minute' from band
              where band.id = grant_link.band_id and band.legacy_id = ${BAND} and grant_link.revoked_at is null`;
    check('once expired, the guest is out', (await call(guest, 'GET', `/api/data/${BAND}/band.json`)).status === 401);
    check('opening it → 410', (await call(null, 'POST', `/api/guest/${tokenOf(first?.url)}`)).status === 410);
    check('managers still see it, marked expired', linkOf(await call(manager.cookie, 'GET', path))?.expired === true);
    const revived = linkOf(await call(manager.cookie, 'PUT', path, { expiresAt: null }));
    check('removing the expiry brings the same link back', revived?.url === first?.url && revived?.expiresAt === null && !revived.expired);
    check('…and the guest is back in', (await call(guest, 'GET', `/api/data/${BAND}/band.json`)).status === 200);

    console.log('\n--- reset');
    check('editor can’t reset', (await call(editor.cookie, 'POST', path, {})).status === 403);
    const reset = linkOf(await call(owner.cookie, 'POST', path, {}));
    check('owner resets: a new link', !!reset && reset.url !== first?.url);
    check('the old link’s holders are out on the next request', (await call(guest, 'GET', `/api/data/${BAND}/band.json`)).status === 401);
    check('opening the old link → 410', (await call(null, 'POST', `/api/guest/${tokenOf(first?.url)}`)).status === 410);
    const fresh = guestCookie((await call(null, 'POST', `/api/guest/${tokenOf(reset?.url)}`)).setCookie);
    check('the new link works', (await call(fresh, 'GET', `/api/data/${BAND}/band.json`)).status === 200);
    const [{ live, kept }] = await sql`select count(*) filter (where revoked_at is null)::int live,
                                              count(*) filter (where revoked_at is not null and token is null)::int kept
                                       from grant_link g join band b on b.id = g.band_id where b.legacy_id = ${BAND}`;
    check('one live link; the old one kept, its token erased', live === 1 && kept === 1, `live ${live}, revoked without token ${kept}`);

    console.log('\n--- turning it off');
    check('manager turns it off', (await call(manager.cookie, 'DELETE', path)).status === 200);
    check('…twice → 404', (await call(manager.cookie, 'DELETE', path)).status === 404);
    check('it reads as off', (await call(manager.cookie, 'GET', path)).json.link === null);
    check('the guest is out', (await call(fresh, 'GET', `/api/data/${BAND}/band.json`)).status === 401);
    check('…and gone from /api/me', ((await call(fresh, 'GET', '/api/me')).json.guest as unknown[]).length === 0);
    check('changing the expiry of an off link → 404', (await call(manager.cookie, 'PUT', path, { expiresAt: null })).status === 404);

    console.log('\n--- leaving');
    const left = await call(fresh, 'DELETE', '/api/guest');
    check('leave clears pp_guest', left.status === 200 && left.setCookie.some((c) => c.startsWith('pp_guest=;') && /Max-Age=0/.test(c)));

    const audit = await sql`select action from audit_log a join band b on b.id = a.band_id where b.legacy_id = ${BAND}`;
    const actions = audit.map((r) => r.action as string);
    check('every change is audited',
      ['guest_link.create', 'guest_link.expiry', 'guest_link.reset', 'guest_link.revoke'].every((x) => actions.includes(x)),
      actions.join(', '));
  } finally {
    const r2 = !!getR2Client();
    if (r2) {
      for (const band of [BAND, OTHER, THIRD]) {
        for (const key of await r2ListKeys(`${band}/`)) await r2DeleteKey(key);
      }
    }
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    await sql`delete from app_user where id = any(${ids})`;
    if (r2) {
      const { removed } = await syncRegistry(false);
      console.log(`\ncleanup: R2 registry.json rewritten from Postgres (removed ${removed.join(', ') || 'nothing'})`);
    }
    const [{ left }] = await sql`select count(*)::int left from app_user where email like ${TAG + '%'}`;
    console.log(`cleanup: ${left} test user(s)${r2 ? `, ${(await r2ListKeys(TAG)).length} R2 object(s)` : ''} left`);
    await sql.end();
  }
  console.log(`===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
