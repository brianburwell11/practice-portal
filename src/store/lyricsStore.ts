import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

interface LyricsState {
  lines: LyricsLine[];
  /** Whether `setLyrics` has been called for the currently-loaded song.
   *  False between `clear()` and the lyrics fetch settling — lets
   *  consumers distinguish "not loaded yet" from "loaded, no lyrics". */
  loaded: boolean;
  mobileVisible: boolean;
  setLyrics: (lines: LyricsLine[]) => void;
  clear: () => void;
  toggleMobileVisible: () => void;
}

export const useLyricsStore = create<LyricsState>((set) => ({
  lines: [],
  loaded: false,
  mobileVisible: false,
  setLyrics: (raw) =>
    set({
      lines: raw.filter((l) => l.text !== '' || l.instrumental),
      loaded: true,
    }),
  clear: () => set({ lines: [], loaded: false }),
  toggleMobileVisible: () => set((s) => ({ mobileVisible: !s.mobileVisible })),
}));
