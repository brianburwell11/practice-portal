/**
 * The R2 JSON layout, served from and mirrored into Postgres (Phase 4).
 *
 * Every JSON document the SPA reads has an R2 key. This module answers each
 * key from Postgres with the same document R2 holds, and applies each R2
 * write, delete and copy to Postgres so the two stay in step while R2 is
 * still where the admin writes.
 *
 * Two kinds of document:
 *
 *   item  — band.json, a song's config/lyrics/notes, a setlist. Stored as-is
 *           in a row (jsonb), so a read returns exactly what was written.
 *   index — registry.json, discography.json, setlists/index.json. Never
 *           stored: built from the item rows on read. Checked against the
 *           real data before relying on it — every index entry is a pure
 *           function of its item (registry ← band.json, discography ←
 *           config.json, setlist index ← setlist). Writes to an index only
 *           carry *order*, which the band picker and setlist menu show as-is.
 *
 * Bands are addressed by `band.legacy_id` and songs by `song.media_prefix`,
 * because every R2 key is built from those ids and media doesn't move.
 */
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { db as defaultDb } from '../db/client';
import * as schema from '../db/schema';
import { HttpError } from './http';
import { r2PublicUrl } from './r2';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Key =
  | { kind: 'registry' }
  | { kind: 'band'; band: string }
  | { kind: 'discography'; band: string }
  | { kind: 'song'; band: string; song: string; file: 'config' | 'lyrics' | 'notes' }
  | { kind: 'setlistIndex'; band: string }
  | { kind: 'setlist'; band: string; setlist: string };

const SEG = '[^/]+';

/** Parse an R2 key into the document it names, or null if it isn't one. */
export function parseKey(key: string): Key | null {
  let m: RegExpMatchArray | null;
  if (key === 'registry.json') return { kind: 'registry' };
  if ((m = key.match(new RegExp(`^(${SEG})/band\\.json$`)))) return { kind: 'band', band: m[1] };
  if ((m = key.match(new RegExp(`^(${SEG})/songs/discography\\.json$`)))) return { kind: 'discography', band: m[1] };
  if ((m = key.match(new RegExp(`^(${SEG})/songs/(${SEG})/(config|lyrics|notes)\\.json$`)))) {
    return { kind: 'song', band: m[1], song: m[2], file: m[3] as 'config' | 'lyrics' | 'notes' };
  }
  if ((m = key.match(new RegExp(`^(${SEG})/setlists/index\\.json$`)))) return { kind: 'setlistIndex', band: m[1] };
  if ((m = key.match(new RegExp(`^(${SEG})/setlists/(${SEG})\\.json$`)))) return { kind: 'setlist', band: m[1], setlist: m[2] };
  return null;
}

function publicUrl(key: string): string {
  const base = r2PublicUrl();
  if (!base) throw new Error('R2_PUBLIC_URL is not set');
  return `${base.replace(/\/$/, '')}/${key}`;
}

function toKey(url: string): string {
  const base = r2PublicUrl();
  if (!base) throw new Error('R2_PUBLIC_URL is not set');
  const prefix = `${base.replace(/\/$/, '')}/`;
  if (!url.startsWith(prefix)) throw new Error(`Not an R2 public URL: ${url}`);
  return url.slice(prefix.length);
}

// ------------------------------------------------------------------- read

type BandRow = typeof schema.band.$inferSelect;

/**
 * A live band the viewer may read: any Public band, or a Members-only band
 * they own or belong to. A Members-only band refuses everyone else — 401 when
 * signed out, so the SPA can offer sign-in; 403 when signed in but not a
 * member. Unknown bands are null (404), as in R2.
 */
async function findBand(d: Db, legacyId: string, viewerId: string | undefined): Promise<BandRow | null> {
  const [row] = await d.select().from(schema.band).where(and(
    eq(schema.band.legacyId, legacyId),
    isNull(schema.band.deletedAt),
  ));
  if (!row) return null;
  if (row.visibility === 'public') return row;
  if (!viewerId) throw new HttpError(401, 'Sign in to view this band');
  if (row.ownerUserId === viewerId) return row;
  const [m] = await d.select({ role: schema.membership.role }).from(schema.membership)
    .where(and(eq(schema.membership.bandId, row.id), eq(schema.membership.userId, viewerId)));
  if (!m) throw new HttpError(403, "You're not a member of this band");
  return row;
}

function bandJson(b: BandRow): Record<string, unknown> {
  const doc: Record<string, unknown> = { id: b.legacyId, name: b.name, route: b.slug, colors: b.colors };
  if (b.logoKey) doc.logo = publicUrl(b.logoKey);
  if (b.website !== null) doc.website = b.website;
  if (b.palette !== null) doc.palette = b.palette;
  return doc;
}

const liveSongs = (bandId: string) => and(eq(schema.song.bandId, bandId), isNull(schema.song.deletedAt));
const liveSetlists = (bandId: string) => and(eq(schema.setlist.bandId, bandId), isNull(schema.setlist.deletedAt));
const setlistById = (bandId: string, id: string) => and(liveSetlists(bandId), sql`${schema.setlist.config}->>'id' = ${id}`);

/**
 * The document at `key`, built from Postgres — or null where R2 would 404.
 * An unknown or malformed key is a 404 too. `viewerId` is the signed-in
 * user, if any: Members-only bands are visible to their members alone.
 */
export async function readDocument(
  key: string,
  d: Db = defaultDb() as unknown as Db,
  viewerId?: string,
): Promise<unknown | null> {
  const k = parseKey(key);
  if (!k) return null;

  if (k.kind === 'registry') {
    // Public bands, plus Members-only bands the viewer owns or belongs to.
    const visible = viewerId
      ? or(
        eq(schema.band.visibility, 'public'),
        eq(schema.band.ownerUserId, viewerId),
        sql`exists (select 1 from ${schema.membership} where ${schema.membership.bandId} = ${schema.band.id}
                    and ${schema.membership.userId} = ${viewerId})`,
      )
      : eq(schema.band.visibility, 'public');
    const bands = await d.select().from(schema.band)
      .where(and(visible, isNull(schema.band.deletedAt), sql`${schema.band.legacyId} is not null`))
      .orderBy(asc(schema.band.position), asc(schema.band.createdAt));
    return {
      bands: bands.map((b) => {
        const entry: Record<string, unknown> = {
          id: b.legacyId, name: b.name, route: b.slug, background: b.colors.background, text: b.colors.text,
        };
        if (b.logoKey) entry.logo = publicUrl(b.logoKey);
        return entry;
      }),
    };
  }

  const band = await findBand(d, k.band, viewerId);
  if (!band) return null;

  switch (k.kind) {
    case 'band':
      return bandJson(band);

    case 'discography': {
      const songs = await d.select({ config: schema.song.config, mediaPrefix: schema.song.mediaPrefix })
        .from(schema.song).where(liveSongs(band.id))
        .orderBy(asc(schema.song.createdAt), asc(schema.song.title));
      return {
        songs: songs.map(({ config, mediaPrefix }) => {
          const c = config as { id: string; slug?: string; title: string; artist: string };
          const entry: Record<string, unknown> = { id: c.id };
          if (c.slug) entry.slug = c.slug;
          entry.title = c.title;
          entry.artist = c.artist;
          entry.audioBasePath = publicUrl(mediaPrefix!);
          return entry;
        }),
      };
    }

    case 'song': {
      const [row] = await d.select({ config: schema.song.config, lyrics: schema.song.lyrics, notes: schema.song.notes })
        .from(schema.song)
        .where(and(liveSongs(band.id), eq(schema.song.mediaPrefix, `${k.band}/songs/${k.song}`)));
      return row ? row[k.file] ?? null : null;
    }

    case 'setlistIndex': {
      const rows = await d.select({ config: schema.setlist.config }).from(schema.setlist)
        .where(liveSetlists(band.id))
        .orderBy(asc(schema.setlist.position), asc(schema.setlist.createdAt));
      return {
        setlists: rows.map(({ config }) => {
          const c = config as { id: string; slug?: string; name: string };
          return { id: c.id, ...(c.slug ? { slug: c.slug } : {}), name: c.name };
        }),
      };
    }

    case 'setlist': {
      const [row] = await d.select({ config: schema.setlist.config }).from(schema.setlist)
        .where(setlistById(band.id, k.setlist));
      return row?.config ?? null;
    }
  }
}

// ----------------------------------------------------------------- mirror

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Make `slug` free for `keepId` within its band. R2 has no uniqueness rule,
 * and the admin leans on that: a rename writes the new song (or setlist)
 * before deleting the old one, so for a moment both carry the same slug. The
 * last writer takes it — as in R2 — and any other holder falls back to a slug
 * built from its own id, as its URL does. Reads build slugs from the stored
 * documents, never from this column, so nothing the SPA sees changes.
 */
async function freeSlug(
  tx: Tx,
  table: typeof schema.song | typeof schema.setlist,
  bandId: string,
  slug: string,
  keepId: string | undefined,
  legacyIdOf: (row: { id: string; mediaPrefix?: string | null; config: unknown }) => string,
): Promise<void> {
  const rows = await tx.select().from(table).where(eq(table.bandId, bandId));
  const taken = new Set(rows.map((r) => r.slug));
  for (const h of rows) {
    if (h.slug !== slug || h.id === keepId) continue;
    const legacy = legacyIdOf(h as never);
    // URL form first, then the raw id, then something certainly unused.
    const candidates = [legacy.replace(/^setlist-/, ''), legacy, `${legacy}-${h.id.slice(0, 8)}`];
    const fallback = candidates.find((c) => c !== slug && !taken.has(c))!;
    console.warn(`[r2 → postgres] slug "${slug}" moves to the latest write; ${legacy} falls back to "${fallback}"`);
    await tx.update(table).set({ slug: fallback }).where(eq(table.id, h.id));
    taken.add(fallback);
  }
}

const songLegacyId = (r: { mediaPrefix?: string | null }) => r.mediaPrefix!.split('/').pop()!;
const setlistLegacyId = (r: { config: unknown }) => (r.config as { id: string }).id;

/**
 * Apply an R2 JSON write to Postgres. Called after the R2 write succeeds.
 * Keys outside the document layout are ignored.
 */
export async function mirrorWrite(key: string, data: unknown, d: Db = defaultDb() as unknown as Db): Promise<void> {
  const k = parseKey(key);
  if (!k) return;

  await d.transaction(async (tx) => {
    if (k.kind === 'registry') {
      const entries = (data as { bands?: { id: string }[] }).bands ?? [];
      for (const [position, e] of entries.entries()) {
        await tx.update(schema.band).set({ position }).where(eq(schema.band.legacyId, e.id));
      }
      return;
    }

    if (k.kind === 'band') {
      const b = data as { id: string; name: string; route: string; colors: schema.BandColors; logo?: string; website?: string; palette?: string[] };
      const values = {
        name: b.name,
        slug: b.route,
        colors: b.colors,
        logoKey: b.logo ? toKey(b.logo) : null,
        website: b.website ?? null,
        palette: b.palette ?? null,
      };
      const [existing] = await tx.select({ id: schema.band.id }).from(schema.band).where(eq(schema.band.legacyId, k.band));
      if (existing) {
        await tx.update(schema.band).set(values).where(eq(schema.band.id, existing.id));
        return;
      }
      // A band created through the dev admin. Until Phase 5 there's exactly
      // one admin, who already owns the imported bands.
      const [owner] = await tx.select({ id: schema.band.ownerUserId }).from(schema.band)
        .orderBy(asc(schema.band.createdAt)).limit(1);
      if (!owner) throw new Error(`Can't mirror new band ${k.band}: no existing band to take an owner from`);
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${schema.band.position}) + 1, 0)` }).from(schema.band);
      await tx.insert(schema.band).values({
        ...values, legacyId: k.band, ownerUserId: owner.id, visibility: 'public', position: next,
      });
      return;
    }

    // Every other document belongs to a band that must already be mirrored.
    const [band] = await tx.select({ id: schema.band.id, ownerUserId: schema.band.ownerUserId })
      .from(schema.band).where(eq(schema.band.legacyId, k.band));
    if (!band) throw new Error(`Can't mirror ${key}: band ${k.band} isn't in Postgres`);

    switch (k.kind) {
      case 'discography':
        // Derived from the configs on read. Song membership follows the
        // config files, and the UI sorts songs by title.
        return;

      case 'song': {
        const mediaPrefix = `${k.band}/songs/${k.song}`;
        const [row] = await tx.select({ id: schema.song.id }).from(schema.song)
          .where(and(eq(schema.song.bandId, band.id), eq(schema.song.mediaPrefix, mediaPrefix)));
        if (k.file === 'config') {
          const c = data as { slug?: string; title: string; artist: string };
          const slug = c.slug ?? (row ? undefined : k.song);
          if (slug) await freeSlug(tx, schema.song, band.id, slug, row?.id, songLegacyId);
          if (row) {
            await tx.update(schema.song).set({
              config: data, title: c.title, artist: c.artist, updatedAt: new Date(),
              ...(c.slug ? { slug: c.slug } : {}),
            }).where(eq(schema.song.id, row.id));
          } else {
            await tx.insert(schema.song).values({
              bandId: band.id, slug: c.slug ?? k.song, title: c.title, artist: c.artist,
              config: data, mediaPrefix, uploadedBy: band.ownerUserId,
            });
          }
          return;
        }
        if (!row) throw new Error(`Can't mirror ${key}: song has no config in Postgres`);
        await tx.update(schema.song).set({ [k.file]: data, updatedAt: new Date() }).where(eq(schema.song.id, row.id));
        return;
      }

      case 'setlistIndex': {
        const entries = (data as { setlists?: { id: string }[] }).setlists ?? [];
        for (const [position, e] of entries.entries()) {
          await tx.update(schema.setlist).set({ position }).where(setlistById(band.id, e.id));
        }
        return;
      }

      case 'setlist': {
        const c = data as { id: string; slug?: string; name: string };
        const [row] = await tx.select({ id: schema.setlist.id }).from(schema.setlist).where(setlistById(band.id, k.setlist));
        const slug = c.slug ?? (row ? undefined : k.setlist.replace(/^setlist-/, ''));
        if (slug) await freeSlug(tx, schema.setlist, band.id, slug, row?.id, setlistLegacyId);
        if (row) {
          await tx.update(schema.setlist).set({ config: data, name: c.name, ...(c.slug ? { slug: c.slug } : {}) })
            .where(eq(schema.setlist.id, row.id));
          return;
        }
        // New setlists go last; the index write that follows sets the real order.
        const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${schema.setlist.position}) + 1, 0)` })
          .from(schema.setlist).where(eq(schema.setlist.bandId, band.id));
        await tx.insert(schema.setlist).values({
          bandId: band.id, slug: c.slug ?? k.setlist.replace(/^setlist-/, ''), name: c.name, position: next, config: data,
        });
        return;
      }
    }
  });
}

/** Apply an R2 delete to Postgres. Deleting what isn't there is a no-op, as in R2. */
export async function mirrorDelete(key: string, d: Db = defaultDb() as unknown as Db): Promise<void> {
  const k = parseKey(key);
  if (!k || k.kind === 'registry' || k.kind === 'discography' || k.kind === 'setlistIndex') return;

  if (k.kind === 'band') {
    // Cascades to the band's songs and setlists, as deleting its prefix does.
    await d.delete(schema.band).where(eq(schema.band.legacyId, k.band));
    return;
  }

  const [band] = await d.select({ id: schema.band.id }).from(schema.band).where(eq(schema.band.legacyId, k.band));
  if (!band) return;

  if (k.kind === 'song') {
    const where = and(eq(schema.song.bandId, band.id), eq(schema.song.mediaPrefix, `${k.band}/songs/${k.song}`));
    if (k.file === 'config') await d.delete(schema.song).where(where);
    else await d.update(schema.song).set({ [k.file]: null, updatedAt: new Date() }).where(where);
    return;
  }

  await d.delete(schema.setlist).where(setlistById(band.id, k.setlist));
}
