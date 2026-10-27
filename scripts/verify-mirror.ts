/**
 * Replays each admin flow's R2 JSON operations — in the order the handlers in
 * server/core/handlers/ perform them — through the Postgres mirror, against a
 * throwaway in-process database, and checks what /api/data would then serve.
 *
 *   npx tsx scripts/verify-mirror.ts
 *
 * Offline: no R2, no DATABASE_URL. The sequences matter more than the single
 * writes — a rename deletes the old config (and so its row) *before* copying
 * the lyrics across, which is why copies mirror from the destination.
 */
import { mirrorDelete, mirrorWrite, readDocument, type Db } from '../server/core/documents';
import * as schema from '../server/db/schema';

const R2 = 'https://r2.example';
process.env.R2_PUBLIC_URL = R2;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}
/** JSON with object keys sorted — jsonb doesn't keep key order, and R2 readers don't care. */
const canonical = (v: unknown) => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

const band = {
  id: 'b1', name: 'Band One', route: 'band.one',
  colors: { primary: '#fff', accent: '#f00', background: '#000', text: '#eee' },
  logo: `${R2}/b1/assets/logo.png`,
};
const config = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Song ${id}`, artist: 'Artist', key: 'C', durationSeconds: 100, beatOffset: 0,
  stems: [{ id: 's', label: 'S', file: 's.opus', defaultVolume: 1, defaultPan: 0, color: '#fff' }],
  tempoMap: [{ beat: 0, bpm: 120 }], timeSignatureMap: [{ beat: 0, numerator: 4, denominator: 4 }],
  metronome: { clickSound: 'c', accentPattern: [1], subdivisions: 1 }, markers: [], ...extra,
});
const lyrics = { lines: [{ text: 'la', time: 1 }] };
const notes = { notes: [{ id: 'n1', time: 2, text: 'watch the turnaround' }] };

async function main(): Promise<void> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const pg = await PGlite.create({ extensions: { citext } });
  const db = drizzle(pg, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: './server/db/migrations' });

  const read = (key: string) => readDocument(key, db);
  const write = (key: string, data: unknown) => mirrorWrite(key, data, db);
  const del = (key: string) => mirrorDelete(key, db);

  // An existing imported band supplies the owner for bands created in dev.
  const [user] = await db.insert(schema.appUser).values({ email: 'owner@example.com' }).returning();
  await db.insert(schema.band).values({
    slug: 'existing', legacyId: 'b0', name: 'Existing', colors: band.colors, ownerUserId: user.id, visibility: 'public', position: 0,
  });

  console.log('--- putBand (new band)');
  await write('b1/band.json', band);
  await write('registry.json', { bands: [{ id: 'b1' }, { id: 'b0' }] });
  await write('b1/setlists/index.json', { setlists: [] });
  check('band.json round-trips', same(await read('b1/band.json'), band), JSON.stringify(await read('b1/band.json')));
  const reg = await read('registry.json') as { bands: { id: string; route: string; logo?: string }[] };
  check('registry follows the written order', same(reg.bands.map((b) => b.id), ['b1', 'b0']));
  check('registry entry rebuilt from band.json', reg.bands[0].route === 'band.one' && reg.bands[0].logo === band.logo);

  console.log('\n--- add song (config, then discography upsert)');
  await write('b1/songs/s1/config.json', config('s1'));
  await write('b1/songs/discography.json', { songs: [{ id: 's1', title: 'Song s1', artist: 'Artist', audioBasePath: `${R2}/b1/songs/s1` }] });
  check('config round-trips', same(await read('b1/songs/s1/config.json'), config('s1')));
  check('discography lists the song', same(await read('b1/songs/discography.json'), {
    songs: [{ id: 's1', title: 'Song s1', artist: 'Artist', audioBasePath: `${R2}/b1/songs/s1` }],
  }));
  check('no lyrics yet → 404', (await read('b1/songs/s1/lyrics.json')) === null);

  console.log('\n--- edit config (adds a slug)');
  await write('b1/songs/s1/config.json', config('s1', { slug: 'first-song' }));
  const disc = await read('b1/songs/discography.json') as { songs: { slug?: string }[] };
  check('discography picks up the slug', disc.songs[0].slug === 'first-song');

  console.log('\n--- lyrics and notes');
  await write('b1/songs/s1/lyrics.json', lyrics);
  await write('b1/songs/s1/notes.json', notes);
  check('lyrics round-trip', same(await read('b1/songs/s1/lyrics.json'), lyrics));
  check('notes round-trip', same(await read('b1/songs/s1/notes.json'), notes));
  await del('b1/songs/s1/notes.json'); // saving zero notes deletes the file
  check('deleted notes → 404', (await read('b1/songs/s1/notes.json')) === null);
  check('config survives a notes delete', same(await read('b1/songs/s1/config.json'), config('s1', { slug: 'first-song' })));
  await write('b1/songs/s1/notes.json', notes);

  console.log('\n--- setlist save, then delete');
  const setlist = { id: 'setlist-gig', name: 'Gig', entries: [{ type: 'song', songId: 's1' }] };
  await write('b1/setlists/setlist-gig.json', setlist);
  await write('b1/setlists/index.json', { setlists: [{ id: 'setlist-gig', name: 'Gig' }] });
  check('setlist round-trips', same(await read('b1/setlists/setlist-gig.json'), setlist));
  check('setlist index rebuilt', same(await read('b1/setlists/index.json'), { setlists: [{ id: 'setlist-gig', name: 'Gig' }] }));
  const second = { id: 'S2', slug: 'second', name: 'Second', entries: [] };
  await write('b1/setlists/S2.json', second);
  await write('b1/setlists/index.json', { setlists: [{ id: 'S2', slug: 'second', name: 'Second' }, { id: 'setlist-gig', name: 'Gig' }] });
  const idx = await read('b1/setlists/index.json') as { setlists: { id: string }[] };
  check('setlist index follows the written order', same(idx.setlists.map((s) => s.id), ['S2', 'setlist-gig']));
  await del('b1/setlists/S2.json');
  await write('b1/setlists/index.json', { setlists: [{ id: 'setlist-gig', name: 'Gig' }] });
  check('deleted setlist → 404', (await read('b1/setlists/S2.json')) === null);

  console.log('\n--- rename setlist (SetlistModal: save new id, then delete old)');
  const gig2 = { id: 'G2', slug: 'gig', name: 'Gig', entries: [] };
  await write('b1/setlists/G1.json', { ...gig2, id: 'G1' });
  await write('b1/setlists/G2.json', gig2);
  await del('b1/setlists/G1.json');
  check('renamed setlist served under its new id', same(await read('b1/setlists/G2.json'), gig2));
  check('old setlist id → 404', (await read('b1/setlists/G1.json')) === null);
  await del('b1/setlists/G2.json');

  console.log('\n--- rename song s1 → s2 (renameSong order)');
  await write('b1/songs/s2/config.json', { ...config('s1', { slug: 'first-song' }), id: 's2' });
  await del('b1/songs/s1/config.json');
  // r2CopyKey mirrors what R2 then holds at the destination.
  await write('b1/songs/s2/lyrics.json', lyrics);
  await write('b1/songs/s2/notes.json', notes);
  await del('b1/songs/s1/lyrics.json');
  await del('b1/songs/s1/notes.json');
  await write('b1/songs/discography.json', { songs: [{ id: 's2', slug: 'first-song', title: 'Song s1', artist: 'Artist', audioBasePath: `${R2}/b1/songs/s2` }] });
  await write('b1/setlists/setlist-gig.json', { ...setlist, entries: [{ type: 'song', songId: 's2' }] });
  check('old id → 404', (await read('b1/songs/s1/config.json')) === null);
  check('new id has the config', (await read('b1/songs/s2/config.json') as { id: string } | null)?.id === 's2');
  check('lyrics followed the rename', same(await read('b1/songs/s2/lyrics.json'), lyrics));
  check('notes followed the rename', same(await read('b1/songs/s2/notes.json'), notes));
  const d2 = await read('b1/songs/discography.json') as { songs: { id: string; audioBasePath: string }[] };
  check('discography has only the new id', same(d2.songs.map((s) => s.id), ['s2']) && d2.songs[0].audioBasePath === `${R2}/b1/songs/s2`);
  check('setlist points at the new id', same(
    (await read('b1/setlists/setlist-gig.json') as { entries: unknown[] }).entries, [{ type: 'song', songId: 's2' }]));

  console.log('\n--- delete song (deleteSong order)');
  await del('b1/songs/s2/config.json');
  await del('b1/songs/s2/lyrics.json');
  await del('b1/songs/s2/notes.json');
  await write('b1/songs/discography.json', { songs: [] });
  check('song gone', (await read('b1/songs/s2/config.json')) === null);
  check('discography empty', same(await read('b1/songs/discography.json'), { songs: [] }));

  console.log('\n--- errors surface instead of passing silently');
  let threw = false;
  try { await write('nope/songs/x/config.json', config('x')); } catch { threw = true; }
  check('a write for an unknown band throws', threw);
  check('a non-document key is ignored', await write('b1/assets/logo.json', {}).then(() => true, () => false));

  console.log('\n--- delete band (deleteBand order)');
  await write('b1/songs/s3/config.json', config('s3'));
  await del('b1/band.json');
  await del('b1/songs/s3/config.json'); // later deletes under the prefix are no-ops
  await write('registry.json', { bands: [{ id: 'b0' }] });
  check('band → 404', (await read('b1/band.json')) === null);
  check('its songs went with it', (await db.select().from(schema.song)).length === 0);
  check('registry has only the other band', same((await read('registry.json') as { bands: { id: string }[] }).bands.map((b) => b.id), ['b0']));

  await pg.close();
  console.log(`\n===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
