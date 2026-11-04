/**
 * A short-lived in-memory cache for reads that hit Postgres on every request:
 * documents (`/api/data`), media access checks, session and guest-link
 * lookups, and page titles. Neon is a network hop away and can take
 * 0.4 to 2 s per query when cold; a warm cache answers in microseconds.
 *
 * Correctness rules:
 * - Entries live at most `TTL_MS` (30 s), so even a write this process never
 *   sees (a script, another machine) is picked up within that.
 * - Every write request clears everything (`clearCache`, called by the API
 *   adapter after any non-GET request, and after the sign-in routes, which
 *   write on GET). Writes are rare admin actions; reads dominate.
 * - Keys include who is asking wherever the answer depends on it, so one
 *   person's permissions never answer for another.
 * - Concurrent misses share one lookup (the promise is cached), and a
 *   failed lookup is never kept.
 * - Values are cloned on the way out, so a caller can't change what the next
 *   one gets.
 *
 * This relies on a single server process. With more than one machine each
 * would keep its own cache, and a write on one would be invisible to the
 * others for up to `TTL_MS`.
 */

export const TTL_MS = 30_000;
const MAX_ENTRIES = 1000;

interface Entry {
  value: Promise<unknown>;
  expires: number;
}

const entries = new Map<string, Entry>();
let now = () => Date.now();

/**
 * The cached value for `key`, or the result of `load()` (cached for `ttlMs`).
 * Rejections aren't cached.
 */
export async function memo<T>(key: string, load: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expires > now()) {
    // Most recently used goes last.
    entries.delete(key);
    entries.set(key, hit);
    return structuredClone(await hit.value) as T;
  }
  if (hit) entries.delete(key);

  const value = load();
  const entry: Entry = { value, expires: now() + ttlMs };
  entries.set(key, entry);
  // Evict the least recently used past the cap.
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  // A failed load isn't kept (only if it's still this entry: a clear may have
  // replaced it).
  value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
  return structuredClone(await value) as T;
}

/** Forget everything: after any write. */
export function clearCache(): void {
  entries.clear();
}

/** For tests. */
export const cacheForTests = {
  size: () => entries.size,
  setClock(clock: () => number) { now = clock; },
  resetClock() { now = () => Date.now(); },
};

/**
 * The part of a cache key that says who is asking: the user, whether they
 * read as a site admin, and the bands their guest links open.
 */
export function viewerKey(viewer: { userId?: string; siteAdmin?: boolean; guestBandIds?: string[] }): string {
  const guests = viewer.guestBandIds?.length ? [...viewer.guestBandIds].sort().join(',') : '';
  return `${viewer.userId ?? '-'}|${viewer.siteAdmin ? 'admin' : ''}|${guests}`;
}
