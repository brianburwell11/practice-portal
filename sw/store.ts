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
const PINS = 'pins';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      // Version 2: songs and setlists made "Available offline".
      if (!db.objectStoreNames.contains(PINS)) db.createObjectStore(PINS, { keyPath: 'id' });
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

/**
 * A song or setlist made "Available offline": everything it needs is
 * downloaded up front and never evicted, until it's unpinned.
 */
export interface Pin {
  /** `song:<band>/<songId>` or `setlist:<band>/<setlistId>`. */
  id: string;
  kind: 'song' | 'setlist';
  /** The band's id. */
  band: string;
  /** The song's or setlist's id. */
  target: string;
  /** Its title or name, for the list of what's offline. */
  label: string;
  /** The songs it covers, as the media cache names them (`<band>/<folder>`). */
  songs: string[];
  /** True once every file it needs was downloaded. */
  ready: boolean;
  pinnedAt: number;
  /** When it last finished downloading (ms). */
  syncedAt?: number;
}

export async function allPins(): Promise<Pin[]> {
  return (await withStore<Pin[]>(PINS, 'readonly', (s) => s.getAll())) ?? [];
}

export async function putPin(pin: Pin): Promise<void> {
  await withStore(PINS, 'readwrite', (s) => s.put(pin));
}

export async function deletePin(id: string): Promise<void> {
  await withStore(PINS, 'readwrite', (s) => s.delete(id));
}

/** Every song some pin covers. */
export async function pinnedSongs(): Promise<Set<string>> {
  return new Set((await allPins()).flatMap((p) => p.songs));
}

/** Keeps the cache under `CAP_BYTES`, never dropping `keepSong` or a pinned song. */
export async function enforceCap(keepSong?: string): Promise<void> {
  const [entries, pinned] = await Promise.all([allEntries(), pinnedSongs()]);
  await deleteMedia(planEviction(entries, CAP_BYTES, keepSong, pinned));
}

/** Drops every cached song and pin from a band not in `allowedBands` (a band left, or a guest link gone). */
export async function purgeBands(allowedBands: ReadonlySet<string>): Promise<void> {
  const entries = await allEntries();
  await deleteMedia(entries.filter((e) => !allowedBands.has(e.band)).map((e) => e.key));
  for (const pin of await allPins()) {
    if (!allowedBands.has(pin.band)) await deletePin(pin.id);
  }
}

/** Bytes kept offline: pinned songs, and songs kept because they were played. */
export async function usageBytes(): Promise<{ pinned: number; played: number }> {
  const [entries, pinned] = await Promise.all([allEntries(), pinnedSongs()]);
  const out = { pinned: 0, played: 0 };
  for (const e of entries) out[pinned.has(e.song) ? 'pinned' : 'played'] += e.bytes;
  return out;
}

/** When the app last reached the server and confirmed what this device may hold (ms), or null. */
export async function lastVerified(): Promise<number | null> {
  return (await withStore<number>(META, 'readonly', (s) => s.get('lastVerified'))) ?? null;
}

export async function setLastVerified(now = Date.now()): Promise<void> {
  await withStore(META, 'readwrite', (s) => s.put(now, 'lastVerified'));
}

/** Everything gone: every `pp-` cache, every record and every pin (sign-out, the Clear button). */
export async function clearOffline(): Promise<void> {
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([MEDIA, META, PINS], 'readwrite');
      tx.objectStore(MEDIA).clear();
      tx.objectStore(META).clear();
      tx.objectStore(PINS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
