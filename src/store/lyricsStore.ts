import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

interface LyricsState {
  lines: LyricsLine[];
  mobileVisible: boolean;
  setLyrics: (lines: LyricsLine[]) => void;
  clear: () => void;
  toggleMobileVisible: () => void;
}

export const useLyricsStore = create<LyricsState>((set) => ({
  lines: [],
  mobileVisible: false,
  setLyrics: (raw) =>
    set({
      lines: raw.filter((l) => l.text !== '' || l.instrumental),
    }),
  clear: () => set({ lines: [] }),
  toggleMobileVisible: () => set((s) => ({ mobileVisible: !s.mobileVisible })),
}));
