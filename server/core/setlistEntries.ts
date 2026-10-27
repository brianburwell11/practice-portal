import { listSetlistKeys, readJson, writeJson } from './store';

export interface SetlistEntry {
  type: string;
  songId?: string;
  label?: string;
}

/** Return the entry (possibly modified) to keep it, or `null` to remove it. */
export type SetlistEntryTransform = (entry: SetlistEntry) => SetlistEntry | null;

/**
 * Apply `transform` to every entry of every setlist in a band, rewriting
 * only the setlists that actually changed. Used to keep setlists consistent
 * when a song is renamed or deleted.
 */
export async function updateSetlistEntries(bandId: string, transform: SetlistEntryTransform): Promise<void> {
  const setlistKeys = await listSetlistKeys(bandId);

  for (const key of setlistKeys) {
    try {
      const setlist = await readJson<{ entries?: SetlistEntry[] }>(key);
      if (!Array.isArray(setlist.entries)) continue;

      const updated = setlist.entries
        .map((e) => transform(e))
        .filter((e): e is SetlistEntry => e !== null);

      if (updated.length !== setlist.entries.length || JSON.stringify(updated) !== JSON.stringify(setlist.entries)) {
        setlist.entries = updated;
        await writeJson(key, setlist);
      }
    } catch {
      // skip setlists that can't be read
    }
  }
}
