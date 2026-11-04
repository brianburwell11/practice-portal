/** What the offline cache records about each media file it keeps. */
export interface MediaEntry {
  /** The cache key: the same-origin media URL, including its `?v=` version. */
  key: string;
  bytes: number;
  /** The band's id (the first segment of the media path). */
  band: string;
  /** `<band>/<song>`: files are evicted a whole song at a time. */
  song: string;
  /** When the file was last stored or played (ms). */
  lastUsed: number;
}

/**
 * Which files to drop so the cache fits in `capBytes`: whole songs, least
 * recently used first (a half-cached song would be no use offline). The song
 * being stored right now (`keepSong`) is never dropped, even if it alone is
 * over the cap. Returns the keys to delete, oldest songs first.
 */
export function planEviction(entries: readonly MediaEntry[], capBytes: number, keepSong?: string): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= capBytes) return [];

  const songs = new Map<string, { lastUsed: number; bytes: number; keys: string[] }>();
  for (const e of entries) {
    const s = songs.get(e.song) ?? { lastUsed: 0, bytes: 0, keys: [] };
    s.lastUsed = Math.max(s.lastUsed, e.lastUsed);
    s.bytes += e.bytes;
    s.keys.push(e.key);
    songs.set(e.song, s);
  }

  const drop: string[] = [];
  const oldestFirst = [...songs.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [song, s] of oldestFirst) {
    if (total <= capBytes) break;
    if (song === keepSong) continue;
    drop.push(...s.keys);
    total -= s.bytes;
  }
  return drop;
}

/**
 * The band and song a media path belongs to:
 * `/api/media/<band>/songs/<song>/<file>`. Null for anything else (a band
 * logo, say), which the offline cache doesn't keep.
 */
export function mediaIdentity(pathname: string): { band: string; song: string } | null {
  const m = pathname.match(/^\/api\/media\/([^/]+)\/songs\/([^/]+)\/[^/]+$/);
  return m ? { band: m[1], song: `${m[1]}/${m[2]}` } : null;
}
