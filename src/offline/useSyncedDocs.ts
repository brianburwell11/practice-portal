import { useEffect } from 'react';
import { chordsDataSchema, songConfigSchema } from '../config/schema';
import { useBandStore } from '../store/bandStore';
import { useChordsStore } from '../store/chordsStore';
import { useLyricsStore } from '../store/lyricsStore';
import { useSongStore } from '../store/songStore';
import type { LyricsData } from '../audio/lyricsTypes';
import { onDocChange } from './sync';

/**
 * When syncing changes a document of the open song (my timing merged with
 * their mix, or "Keep theirs"), show the new copy.
 */
export function useSyncedDocs(): void {
  useEffect(() => onDocChange((key, data) => {
    const band = useBandStore.getState().currentBand?.id;
    const song = useSongStore.getState().selectedSong;
    if (!band || !song) return;
    const prefix = `${band}/songs/${song.id}/`;
    if (key === `${prefix}lyrics.json`) {
      useLyricsStore.getState().setLyrics((data as LyricsData | null)?.lines ?? []);
    } else if (key === `${prefix}chords.json`) {
      const parsed = chordsDataSchema.safeParse(data ?? { chords: [] });
      if (parsed.success) useChordsStore.getState().setChords(parsed.data.chords);
    } else if (key === `${prefix}config.json`) {
      const parsed = songConfigSchema.safeParse(data);
      if (parsed.success) useSongStore.getState().setSelectedSong(parsed.data);
    }
  }), []);
}
