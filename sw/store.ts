/**
 * The offline cache's storage, shared by the service worker (`sw/sw.ts`) and
 * the app (`src/offline/offline.ts`): Cache Storage holds the files, and
 * IndexedDB holds what eviction needs to know about them. Uses only APIs
 * that pages and workers both have, so either side can clear or purge it,
 * even when the worker isn't running.
 */
import { planEviction, type MediaEntry } from './eviction';

/** Everything the offline cache keeps starts with this. Bump the version to start afresh. */
export const CACHE_PREFIX = 'pp-';
export const MEDIA_CACHE = 'pp-media-v1';
export const SHELL_CACHE = 'pp-shell-v1';
/** Songs are dropped, least recently used first, past this. */
export const CAP_BYTES = 500 * 1024 * 1024;
/** Cached songs aren't played offline once this long has passed without the app reaching the server. */
export const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const DB_NAME = 'pp-offline';
const MEDIA = 'media';
const META = 'meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs `fn` in one transaction and closes the database after (so a clear is never blocked). */
async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function allEntries(): Promise<MediaEntry[]> {
  return (await withStore<MediaEntry[]>(MEDIA, 'readonly', (s) => s.getAll())) ?? [];
}

export async function putEntry(entry: MediaEntry): Promise<void> {
  await withStore(MEDIA, 'readwrite', (s) => s.put(entry));
}

/** Marks a file as just played, so its song is the last to be evicted. */
export async function touchEntry(key: string, now = Date.now()): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA, 'readwrite');
      const store = tx.objectStore(MEDIA);
      const get = store.get(key);
      get.onsuccess = () => {
        const e = get.result as MediaEntry | undefined;
        if (e) store.put({ ...e, lastUsed: now });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Drops files from the cache and their records. */
export async function deleteMedia(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const cache = await caches.open(MEDIA_CACHE);
  await Promise.all(keys.map((k) => cache.delete(k)));
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA, 'readwrite');
      for (const k of keys) tx.objectStore(MEDIA).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Keeps the cache under `CAP_BYTES`, never dropping `keepSong`. */
export async function enforceCap(keepSong?: string): Promise<void> {
  await deleteMedia(planEviction(await allEntries(), CAP_BYTES, keepSong));
}

/** Drops every cached song from a band not in `allowedBands` (a band left, or a guest link gone). */
export async function purgeBands(allowedBands: ReadonlySet<string>): Promise<void> {
  const entries = await allEntries();
  await deleteMedia(entries.filter((e) => !allowedBands.has(e.band)).map((e) => e.key));
}

export async function usageBytes(): Promise<number> {
  return (await allEntries()).reduce((sum, e) => sum + e.bytes, 0);
}

/** When the app last reached the server and confirmed what this device may hold (ms), or null. */
export async function lastVerified(): Promise<number | null> {
  return (await withStore<number>(META, 'readonly', (s) => s.get('lastVerified'))) ?? null;
}

export async function setLastVerified(now = Date.now()): Promise<void> {
  await withStore(META, 'readwrite', (s) => s.put(now, 'lastVerified'));
}

/** Everything gone: every `pp-` cache and every record (sign-out, the Clear button). */
export async function clearOffline(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([MEDIA, META], 'readwrite');
      tx.objectStore(MEDIA).clear();
      tx.objectStore(META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
