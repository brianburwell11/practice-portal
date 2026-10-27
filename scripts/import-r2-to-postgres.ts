/**
 * Phase 4: import the R2 JSON config into Postgres.
 *
 *   npx tsx scripts/import-r2-to-postgres.ts --owner you@example.com --pglite
 *   npx tsx scripts/import-r2-to-postgres.ts --owner you@example.com --dry-run
 *   npx tsx scripts/import-r2-to-postgres.ts --owner you@example.com
 *
 *   --pglite   import into a throwaway in-process Postgres (migrated fresh).
 *              Needs R2 credentials but no database; touches nothing remote.
 *   --dry-run  against $DATABASE_URL: run the whole import and its
 *              verification inside a transaction, then roll it back.
 *   (neither)  against $DATABASE_URL, committed.
 *
 * Walks registry.json → each band.json → songs/discography.json → each song's
 * config.json, lyrics.json, notes.json → setlists/index.json → each setlist.
 * Every record is validated against the existing Zod schemas and a violation
 * aborts the run — nothing is coerced. The *source* JSON is stored, not Zod's
 * parse output, so defaults and stripped keys can't sneak a diff in.
 *
 * Media doesn't move. Rows keep R2 references: `band.legacy_id` (every key
 * for the band starts with it), `band.logo_key`, `song.media_prefix`. The R2
 * JSON is only read, never written — it stays as the rollback path.
 *
 * Verification runs in the same transaction as the writes: row counts match
 * file counts, and every stored jsonb value equals its source file.
 */
import dotenv from 'dotenv';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import {
  bandConfigSchema,
  bandsManifestSchema,
  lyricsDataSchema,
  notesDataSchema,
  setlistConfigSchema,
  setlistIndexSchema,
  songConfigSchema,
  songManifestSchema,
} from '../src/config/schema';
import { isNoSuchKey, r2PublicUrl, r2ReadJson } from '../server/core/r2';
import * as schema from '../server/db/schema';

dotenv.config();

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const SLUG = /^[a-z0-9-]+$/;

// ------------------------------------------------------------------- args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const owner = arg('--owner');
const usePglite = process.argv.includes('--pglite');
const dryRun = process.argv.includes('--dry-run');

if (!owner || !owner.includes('@')) {
  console.error('Usage: import-r2-to-postgres.ts --owner <email> [--pglite | --dry-run]');
  process.exit(2);
}

class ImportError extends Error {}
/** Thrown to unwind the transaction after a successful dry run. */
class Rollback extends Error {}

function fail(msg: string): never {
  throw new ImportError(msg);
}

// ------------------------------------------------------------------- read

async function readValidated<S extends z.ZodType>(key: string, schema: S): Promise<unknown> {
  const data = await r2ReadJson<unknown>(key);
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    fail(`${key} fails its schema — ${issues}`);
  }
  return data;
}

async function readOptional<S extends z.ZodType>(key: string, schema: S): Promise<unknown | null> {
  try {
    return await readValidated(key, schema);
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

interface SourceSong {
  legacyId: string;
  slug: string;
  title: string;
  artist: string;
  mediaPrefix: string;
  config: unknown;
  lyrics: unknown | null;
  notes: unknown | null;
}

interface SourceSetlist {
  legacyId: string;
  slug: string;
  name: string;
  position: number;
  config: unknown;
}

interface SourceBand {
  legacyId: string;
  slug: string;
  name: string;
  position: number;
  colors: schema.BandColors;
  logoKey: string | null;
  website: string | null;
  palette: string[] | null;
  songs: SourceSong[];
  setlists: SourceSetlist[];
}

/** Turn a public R2 URL back into the object key it points at. */
function toKey(url: string, publicBase: string, what: string): string {
  const prefix = `${publicBase.replace(/\/$/, '')}/`;
  if (!url.startsWith(prefix)) fail(`${what} is not under the R2 public URL: ${url}`);
  return url.slice(prefix.length);
}

function requireSlug(slug: string, what: string): string {
  if (!SLUG.test(slug)) fail(`${what}: slug "${slug}" is not [a-z0-9-]+`);
  return slug;
}

async function readSource(publicBase: string): Promise<SourceBand[]> {
  const registry = await readValidated('registry.json', bandsManifestSchema) as z.infer<typeof bandsManifestSchema>;
  const bands: SourceBand[] = [];
  const bandSlugs = new Set<string>();

  for (const [position, entry] of registry.bands.entries()) {
    const id = entry.id;
    const band = await readValidated(`${id}/band.json`, bandConfigSchema) as z.infer<typeof bandConfigSchema>;
    if (band.id !== id) fail(`${id}/band.json has id "${band.id}"`);
    // Band routes are URL paths, not [a-z0-9-] slugs — Zenzi's is `zenzi.music`.
    // Kept verbatim so every existing link still resolves.
    if (bandSlugs.has(band.route)) fail(`duplicate band route "${band.route}"`);
    bandSlugs.add(band.route);

    const disc = await readValidated(`${id}/songs/discography.json`, songManifestSchema) as z.infer<typeof songManifestSchema>;
    const songs: SourceSong[] = [];
    const songSlugs = new Map<string, string>();
    for (const s of disc.songs) {
      const key = `${id}/songs/${s.id}`;
      const config = await readValidated(`${key}/config.json`, songConfigSchema) as z.infer<typeof songConfigSchema>;
      if (config.id !== s.id) fail(`${key}/config.json has id "${config.id}"`);
      if (s.slug && config.slug && s.slug !== config.slug) {
        fail(`${key}: discography slug "${s.slug}" ≠ config slug "${config.slug}"`);
      }
      // Same fallback the SongList uses for the URL hash, so links survive.
      const slug = requireSlug(s.slug ?? config.slug ?? s.id, key);
      const clash = songSlugs.get(slug);
      if (clash) fail(`${id}: songs ${clash} and ${s.id} both resolve to slug "${slug}"`);
      songSlugs.set(slug, s.id);

      if (s.audioBasePath && toKey(s.audioBasePath, publicBase, `${key} audioBasePath`) !== key) {
        fail(`${key}: audioBasePath points elsewhere (${s.audioBasePath})`);
      }

      songs.push({
        legacyId: s.id,
        slug,
        title: config.title,
        artist: config.artist,
        mediaPrefix: key,
        config: await r2ReadJson(`${key}/config.json`),
        lyrics: await readOptional(`${key}/lyrics.json`, lyricsDataSchema),
        notes: await readOptional(`${key}/notes.json`, notesDataSchema),
      });
    }

    const setlists: SourceSetlist[] = [];
    const index = await readOptional(`${id}/setlists/index.json`, setlistIndexSchema) as z.infer<typeof setlistIndexSchema> | null;
    const setlistSlugs = new Map<string, string>();
    const songIds = new Set(songs.map((s) => s.legacyId));
    for (const [pos, e] of (index?.setlists ?? []).entries()) {
      const key = `${id}/setlists/${e.id}.json`;
      const config = await readValidated(key, setlistConfigSchema) as z.infer<typeof setlistConfigSchema>;
      if (config.id !== e.id) fail(`${key} has id "${config.id}"`);
      for (const entry of config.entries) {
        if (entry.type === 'song' && !songIds.has(entry.songId)) fail(`${key}: unknown song ${entry.songId}`);
      }
      // Same fallback the SongList uses for the setlist URL segment.
      const slug = requireSlug(e.slug ?? config.slug ?? e.id.replace(/^setlist-/, ''), key);
      const clash = setlistSlugs.get(slug);
      if (clash) fail(`${id}: setlists ${clash} and ${e.id} both resolve to slug "${slug}"`);
      setlistSlugs.set(slug, e.id);
      setlists.push({ legacyId: e.id, slug, name: config.name, position: pos, config });
    }

    bands.push({
      legacyId: id,
      slug: band.route,
      name: band.name,
      position,
      colors: band.colors,
      logoKey: band.logo ? toKey(band.logo, publicBase, `${id} logo`) : null,
      website: band.website ?? null,
      palette: band.palette ?? null,
      songs,
      setlists,
    });
    console.log(`  read ${id}: ${songs.length} songs, ${setlists.length} setlists`);
  }
  return bands;
}

// ------------------------------------------------------------------ write

async function write(tx: Db, bands: SourceBand[], ownerEmail: string): Promise<void> {
  const already = await tx.select({ id: schema.band.legacyId }).from(schema.band)
    .where(and(isNotNull(schema.band.legacyId), inArray(schema.band.legacyId, bands.map((b) => b.legacyId))));
  if (already.length) {
    fail(`already imported: ${already.map((r) => r.id).join(', ')} — this script doesn't overwrite`);
  }

  await tx.insert(schema.appUser).values({ email: ownerEmail }).onConflictDoNothing();
  const [user] = await tx.select({ id: schema.appUser.id }).from(schema.appUser)
    .where(eq(schema.appUser.email, ownerEmail));

  for (const b of bands) {
    const [row] = await tx.insert(schema.band).values({
      slug: b.slug,
      legacyId: b.legacyId,
      name: b.name,
      position: b.position,
      colors: b.colors,
      logoKey: b.logoKey,
      website: b.website,
      palette: b.palette,
      // Every band is publicly readable today; private is Phase 7's job.
      visibility: 'public',
      ownerUserId: user.id,
    }).returning({ id: schema.band.id });

    if (b.songs.length) {
      await tx.insert(schema.song).values(b.songs.map((s) => ({
        bandId: row.id,
        slug: s.slug,
        title: s.title,
        artist: s.artist,
        config: s.config,
        lyrics: s.lyrics,
        notes: s.notes,
        mediaPrefix: s.mediaPrefix,
        uploadedBy: user.id,
      })));
    }
    if (b.setlists.length) {
      await tx.insert(schema.setlist).values(b.setlists.map((s) => ({
        bandId: row.id,
        slug: s.slug,
        name: s.name,
        position: s.position,
        config: s.config,
      })));
    }
  }
}

// ----------------------------------------------------------------- verify

/** JSON with object keys sorted — jsonb doesn't keep key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val);
}

async function verify(tx: Db, bands: SourceBand[]): Promise<string[]> {
  const problems: string[] = [];
  const same = (what: string, a: unknown, b: unknown) => {
    if (canonical(a) !== canonical(b)) problems.push(`${what} differs from source`);
  };

  const rows = await tx.select().from(schema.band)
    .where(inArray(schema.band.legacyId, bands.map((b) => b.legacyId)));
  if (rows.length !== bands.length) problems.push(`bands: ${rows.length} rows for ${bands.length} files`);

  for (const b of bands) {
    const row = rows.find((r) => r.legacyId === b.legacyId);
    if (!row) { problems.push(`band ${b.legacyId} missing`); continue; }
    same(`band ${b.legacyId}`,
      { slug: row.slug, name: row.name, position: row.position, colors: row.colors, logoKey: row.logoKey, website: row.website, palette: row.palette },
      { slug: b.slug, name: b.name, position: b.position, colors: b.colors, logoKey: b.logoKey, website: b.website, palette: b.palette });

    const songs = await tx.select().from(schema.song).where(eq(schema.song.bandId, row.id));
    if (songs.length !== b.songs.length) problems.push(`${b.legacyId}: ${songs.length} song rows for ${b.songs.length} files`);
    for (const s of b.songs) {
      const r = songs.find((x) => x.mediaPrefix === s.mediaPrefix);
      if (!r) { problems.push(`song ${s.mediaPrefix} missing`); continue; }
      if (r.slug !== s.slug) problems.push(`song ${s.mediaPrefix}: slug ${r.slug} ≠ ${s.slug}`);
      same(`song ${s.mediaPrefix} config`, r.config, s.config);
      same(`song ${s.mediaPrefix} lyrics`, r.lyrics, s.lyrics);
      same(`song ${s.mediaPrefix} notes`, r.notes, s.notes);
    }

    const setlists = await tx.select().from(schema.setlist).where(eq(schema.setlist.bandId, row.id));
    if (setlists.length !== b.setlists.length) problems.push(`${b.legacyId}: ${setlists.length} setlist rows for ${b.setlists.length} files`);
    for (const s of b.setlists) {
      const r = setlists.find((x) => x.slug === s.slug);
      if (!r) { problems.push(`setlist ${b.legacyId}/${s.legacyId} missing`); continue; }
      if (r.position !== s.position) problems.push(`setlist ${s.legacyId}: position ${r.position} ≠ ${s.position}`);
      same(`setlist ${b.legacyId}/${s.legacyId} config`, r.config, s.config);
    }
  }
  return problems;
}

// ------------------------------------------------------------------- main

async function openDb(): Promise<{ db: Db; label: string; close: () => Promise<void> }> {
  if (usePglite) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { citext } = await import('@electric-sql/pglite/contrib/citext');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const pg = await PGlite.create({ extensions: { citext } });
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: './server/db/migrations' });
    return { db: db as unknown as Db, label: 'PGlite (throwaway)', close: () => pg.close() };
  }
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set (or pass --pglite)');
  const { createDb } = await import('../server/db/client');
  const db = createDb(url);
  return {
    db: db as unknown as Db,
    label: `${new URL(url).host}${dryRun ? ' (dry run, rolled back)' : ''}`,
    close: () => db.$client.end(),
  };
}

async function main(): Promise<void> {
  const publicBase = r2PublicUrl();
  if (!publicBase) fail('R2_PUBLIC_URL is not set');

  console.log('Reading R2…');
  const bands = await readSource(publicBase);
  const songs = bands.reduce((n, b) => n + b.songs.length, 0);
  const setlists = bands.reduce((n, b) => n + b.setlists.length, 0);
  const lyrics = bands.reduce((n, b) => n + b.songs.filter((s) => s.lyrics).length, 0);
  const notes = bands.reduce((n, b) => n + b.songs.filter((s) => s.notes).length, 0);
  console.log(`  source: ${bands.length} bands, ${songs} songs (${lyrics} lyrics, ${notes} notes), ${setlists} setlists — all schema-valid`);

  const { db, label, close } = await openDb();
  console.log(`\nImporting into ${label}…`);
  let problems: string[] = [];
  try {
    await db.transaction(async (tx) => {
      await write(tx, bands, owner!);
      problems = await verify(tx, bands);
      if (problems.length) fail(`verification failed:\n  ${problems.join('\n  ')}`);
      console.log('  verified: row counts match file counts; every config, lyrics, notes and setlist equals its source');
      if (dryRun) throw new Rollback();
    });
    console.log(usePglite ? '\nDone (throwaway database, nothing kept).' : '\nCommitted.');
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
    console.log('\nDry run OK — rolled back, database unchanged.');
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof ImportError ? 'ABORTED' : 'ERROR'}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
