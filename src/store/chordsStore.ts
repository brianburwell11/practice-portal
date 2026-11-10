import { create } from 'zustand';
import type { ChordEvent } from '../audio/chordsTypes';

/** How many seconds ahead the chord lane shows. A listener setting. */
export const LOOK_AHEAD_OPTIONS = [3, 5, 8] as const;
export type LookAhead = (typeof LOOK_AHEAD_OPTIONS)[number];

const LOOK_AHEAD_KEY = 'practice-portal.chordLookAhead';

function loadLookAhead(): LookAhead {
  try {
    const n = Number(window.localStorage.getItem(LOOK_AHEAD_KEY));
    return (LOOK_AHEAD_OPTIONS as readonly number[]).includes(n) ? (n as LookAhead) : 5;
  } catch {
    return 5;
  }
}

interface ChordsState {
  /** Sorted by time. */
  chords: ChordEvent[];
  /** Whether `setChords` has run for the loaded song: tells "not loaded yet"
   *  apart from "loaded, no chords", like the lyrics store. */
  loaded: boolean;
  lookAhead: LookAhead;
  /** Phones: the lane shows only when its button is on, like the lyrics. */
  mobileVisible: boolean;
  setChords: (chords: ChordEvent[]) => void;
  clear: () => void;
  setLookAhead: (s: LookAhead) => void;
  toggleMobileVisible: () => void;
}

export const useChordsStore = create<ChordsState>((set) => ({
  chords: [],
  loaded: false,
  lookAhead: typeof window === 'undefined' ? 5 : loadLookAhead(),
  mobileVisible: false,
  setChords: (raw) =>
    set({
      chords: raw.filter((c) => c.symbol.trim() !== '').sort((a, b) => a.time - b.time),
      loaded: true,
    }),
  clear: () => set({ chords: [], loaded: false }),
  setLookAhead: (lookAhead) => {
    try {
      window.localStorage.setItem(LOOK_AHEAD_KEY, String(lookAhead));
    } catch { /* private mode */ }
    set({ lookAhead });
  },
  toggleMobileVisible: () => set((s) => ({ mobileVisible: !s.mobileVisible })),
}));
