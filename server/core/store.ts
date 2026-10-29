/**
 * Postgres first (Phase 6b). Handlers read and write the R2 layout's JSON
 * documents through here; inside a write request this is a transaction:
 *
 *   - JSON documents (band.json, configs, lyrics, notes, setlists and the
 *     index documents) are read from and written to Postgres, in the one
 *     transaction the request runs in, alongside its audit row.
 *   - R2 gets a copy of each JSON write and every delete *after* the commit,
 *     so a request that fails leaves R2 untouched and Postgres rolled back.
 *     The copy keeps the GitHub Pages build and the rollback path working.
 *   - Media (audio, scores, logos) never enters Postgres. Copies run during
 *     the request — a failed copy aborts it before anything commits — and
 *     deletes wait until after the commit: copy before, delete after, so
 *     Postgres never points at objects that are gone.
 *
 * Outside a request context (scripts, the importer) these fall through to R2
 * directly, as before.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { mirrorDelete, mirrorWrite, parseKey, readDocument, readDocumentUnchecked, type Db } from './documents';
import {
  r2CopyKey as rawCopy,
  r2DeleteKey as rawDelete,
  r2ListKeys,
  r2ReadJson as rawRead,
  r2WriteJson as rawWrite,
} from './r2';
import type { Actor, RouteDef } from './types';

interface RequestContext {
  tx: Db;
  actor: Actor | undefined;
  /** R2 operations to run once the transaction has committed. */
  afterCommit: Array<{ what: string; run: () => Promise<void> }>;
}

const context = new AsyncLocalStorage<RequestContext>();

function current(): RequestContext | undefined {
  return context.getStore();
}

/**
 * Lock a song's row until the request's transaction ends, so two requests
 * editing the same song document (its notes) take turns instead of one
 * overwriting the other. False if there's no such song.
 */
export async function lockSong(bandLegacyId: string, songId: string): Promise<boolean> {
  const ctx = current();
  if (!ctx) throw new Error('lockSong needs a request transaction');
  const rows = await ctx.tx.select({ id: schema.song.id }).from(schema.song)
    .where(and(eq(schema.song.mediaPrefix, `${bandLegacyId}/songs/${songId}`), isNull(schema.song.deletedAt)))
    .for('update');
  return rows.length > 0;
}

/** What R2 throws for a missing object, so handlers' `isNoSuchKey` checks keep working. */
function noSuchKey(key: string): Error {
  return Object.assign(new Error(`No document at ${key}`), { name: 'NoSuchKey' });
}

export async function readJson<T>(key: string): Promise<T> {
  const ctx = current();
  if (!ctx || !parseKey(key)) return rawRead<T>(key);
  const doc = await readDocumentUnchecked(key, ctx.tx);
  if (doc === null) throw noSuchKey(key);
  // A copy: handlers mutate what they read before writing it back.
  return structuredClone(doc) as T;
}

export async function writeJson(key: string, data: unknown): Promise<void> {
  const ctx = current();
  if (!ctx || !parseKey(key)) return rawWrite(key, data);
  await mirrorWrite(key, data, ctx.tx, { actorId: ctx.actor?.userId });
  // The R2 copy is public. Its band list holds only what a signed-out
  // visitor may see (Public bands), never the full list a handler wrote.
  const snapshot = key === 'registry.json'
    ? await readDocument(key, ctx.tx)
    : structuredClone(data);
  ctx.afterCommit.push({ what: `write ${key}`, run: () => rawWrite(key, snapshot) });
}

/** Delete a document or a media object. Inside a request, R2 deletes wait for the commit. */
export async function deleteObject(key: string): Promise<void> {
  const ctx = current();
  if (!ctx) return rawDelete(key);
  if (parseKey(key)) await mirrorDelete(key, ctx.tx);
  ctx.afterCommit.push({ what: `delete ${key}`, run: () => rawDelete(key) });
}

/** Copy a document or a media object. Media copies happen now; document copies go through Postgres. */
export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  const ctx = current();
  if (!ctx || !parseKey(toKey)) return rawCopy(fromKey, toKey);
  const doc = await readDocumentUnchecked(fromKey, ctx.tx);
  if (doc === null) throw noSuchKey(fromKey);
  await writeJson(toKey, doc);
}

/**
 * Setlist document keys for a band — from Postgres inside a request, so a
 * setlist whose R2 copy hasn't been written yet is still found.
 */
export async function listSetlistKeys(bandLegacyId: string): Promise<string[]> {
  const ctx = current();
  if (!ctx) {
    return (await r2ListKeys(`${bandLegacyId}/setlists/`)).filter((k) => k.endsWith('.json') && !k.endsWith('/index.json'));
  }
  const index = await readDocumentUnchecked(`${bandLegacyId}/setlists/index.json`, ctx.tx) as { setlists: { id: string }[] } | null;
  return (index?.setlists ?? []).map((s) => `${bandLegacyId}/setlists/${s.id}.json`);
}

/**
 * Run a write route's handler as one transaction with its audit row, then
 * copy its JSON writes and deletes to R2. The audit row goes in first: a band
 * deletion nulls its `band_id` by cascade, which an insert afterwards would
 * violate. A failed R2 copy after commit is logged, not fatal — Postgres is
 * the source of truth, and `check-data-parity` shows the drift.
 */
export async function inRequestTransaction<T>(
  route: RouteDef,
  params: Record<string, string>,
  actor: Actor | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const afterCommit: RequestContext['afterCommit'] = [];
  const result = await (db() as unknown as Db).transaction(async (tx) => {
    const { bandId: legacyId, ...target } = params;
    let bandId: string | null = null;
    if (legacyId) {
      const [band] = await tx.select({ id: schema.band.id }).from(schema.band)
        .where(and(eq(schema.band.legacyId, legacyId), isNull(schema.band.deletedAt)));
      bandId = band?.id ?? null;
    }
    await tx.insert(schema.auditLog).values({
      bandId,
      actorId: actor?.userId ?? null,
      actorKind: actor ? 'user' : 'system',
      action: route.name,
      target: legacyId ?? null,
      diff: Object.keys(target).length ? target : null,
    });
    return context.run({ tx, actor, afterCommit }, run);
  });

  for (const op of afterCommit) {
    try {
      await op.run();
    } catch (err) {
      console.error(`[store] committed to Postgres, but the R2 copy failed (${op.what}):`, err);
    }
  }
  return result;
}

/** Audit a media write once it has succeeded. */
export async function auditWrite(route: RouteDef, params: Record<string, string>, actor: Actor | undefined): Promise<void> {
  const { bandId: legacyId, ...target } = params;
  let bandId: string | null = null;
  if (legacyId) {
    const [band] = await db().select({ id: schema.band.id }).from(schema.band)
      .where(and(eq(schema.band.legacyId, legacyId), isNull(schema.band.deletedAt)));
    bandId = band?.id ?? null;
  }
  await db().insert(schema.auditLog).values({
    bandId,
    actorId: actor?.userId ?? null,
    actorKind: actor ? 'user' : 'system',
    action: route.name,
    target: legacyId ?? null,
    diff: Object.keys(target).length ? target : null,
  });
}
