import { useEffect, useMemo, useState } from 'react';
import { dataUrl } from '../utils/url';
import type { SongManifestEntry } from '../audio/types';

export interface SongMeta {
  key: string;
  durationSeconds: number;
  tags: string[];
}

/** The meta the discography entry already carries, or null if it predates key and length. */
function fromEntry(song: SongManifestEntry): SongMeta | null {
  if (song.durationSeconds === undefined) return null;
  return { key: song.key ?? '', durationSeconds: song.durationSeconds, tags: song.tags ?? [] };
}

/**
 * Key, length and tags per song id. The server's discography includes them,
 * so this is normally instant with no requests. Entries without them (a
 * discography cached before they were added) fall back to the song's config.
 */
export function useSongMeta(songs: SongManifestEntry[], bandId: string | undefined): Record<string, SongMeta> {
  const [fetched, setFetched] = useState<Record<string, SongMeta>>({});

  useEffect(() => {
    if (!bandId) return;
    const missing = [...new Set(songs.filter((s) => !fromEntry(s)).map((s) => s.id))];
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (id): Promise<[string, SongMeta] | null> => {
        try {
          const res = await fetch(dataUrl(`${bandId}/songs/${id}/config.json`));
          if (!res.ok) return null;
          const config = await res.json();
          return [id, { key: config.key ?? '', durationSeconds: config.durationSeconds ?? 0, tags: config.tags ?? [] }];
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!cancelled) setFetched(Object.fromEntries(results.filter((r) => r !== null)));
    });
    return () => { cancelled = true; };
  }, [songs, bandId]);

  return useMemo(() => {
    const out: Record<string, SongMeta> = { ...fetched };
    for (const s of songs) {
      const m = fromEntry(s);
      if (m) out[s.id] = m;
    }
    return out;
  }, [songs, fetched]);
}
