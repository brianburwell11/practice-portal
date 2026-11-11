import { create } from 'zustand';
import type { ChordEvent } from '../audio/chordsTypes';
import { phonePanelOpen, rememberPhonePanel } from '../utils/phonePanels';

/** How many seconds ahead the chord lane shows. A listener setting. */
export const LOOK_AHEAD_OPTIONS = [10, 15, 30] as const;
export type LookAhead = (typeof LOOK_AHEAD_OPTIONS)[number];

const LOOK_AHEAD_KEY = 'practice-portal.chordLookAhead';

function loadLookAhead(): LookAhead {
  try {
    const n = Number(window.localStorage.getItem(LOOK_AHEAD_KEY));
    return (LOOK_AHEAD_OPTIONS as readonly number[]).includes(n) ? (n as LookAhead) : 10;
  } catch {
    return 10;
  }
}

interface ChordsState {
  /** Sorted by time. */
  chords: ChordEvent[];
  /** Whether `setChords` has run for the loaded song: tells "not loaded yet"
   *  apart from "loaded, no chords", like the lyrics store. */
  loaded: boolean;
  lookAhead: LookAhead;
  /** Phones: the lane shows when its button is on (open unless this device turned it off). */
  mobileVisible: boolean;
  setChords: (chords: ChordEvent[]) => void;
  clear: () => void;
  setLookAhead: (s: LookAhead) => void;
  toggleMobileVisible: () => void;
}

export const useChordsStore = create<ChordsState>((set) => ({
  chords: [],
  loaded: false,
  lookAhead: typeof window === 'undefined' ? 10 : loadLookAhead(),
  mobileVisible: phonePanelOpen('chords'),
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
  toggleMobileVisible: () =>
    set((s) => {
      rememberPhonePanel('chords', !s.mobileVisible);
      return { mobileVisible: !s.mobileVisible };
    }),
}));
