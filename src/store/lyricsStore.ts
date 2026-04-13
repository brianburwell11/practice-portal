import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

interface LyricsState {
  lines: LyricsLine[];
  setLyrics: (lines: LyricsLine[]) => void;
  clear: () => void;
}

export const useLyricsStore = create<LyricsState>((set) => ({
  lines: [],
  setLyrics: (raw) =>
    set({
      lines: raw.filter((l) => l.text !== '' || l.instrumental),
    }),
  clear: () => set({ lines: [] }),
}));
