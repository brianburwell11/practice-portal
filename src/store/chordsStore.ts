import { create } from 'zustand';
import type { ChordEvent } from '../audio/chordsTypes';
import { phonePanelOpen, rememberPhonePanel } from '../utils/phonePanels';

/** How many seconds ahead the chord lane shows. A listener setting: the
 *  button steps through these, Cmd + scroll or a pinch sets anything between
 *  the min and max. */
export const LOOK_AHEAD_OPTIONS = [10, 15, 30] as const;
export const MIN_LOOK_AHEAD = 4;
export const MAX_LOOK_AHEAD = 60;

const LOOK_AHEAD_KEY = 'practice-portal.chordLookAhead';

function clampLookAhead(n: number): number {
  return Math.max(MIN_LOOK_AHEAD, Math.min(MAX_LOOK_AHEAD, n));
}

function loadLookAhead(): number {
  try {
    const raw = window.localStorage.getItem(LOOK_AHEAD_KEY);
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) && n > 0 ? clampLookAhead(n) : 10;
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
  lookAhead: number;
  /** Phones: the lane shows when its button is on (open unless this device turned it off). */
  mobileVisible: boolean;
  setChords: (chords: ChordEvent[]) => void;
  clear: () => void;
  /** Clamped to MIN_LOOK_AHEAD..MAX_LOOK_AHEAD. */
  setLookAhead: (s: number) => void;
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
  setLookAhead: (s) => {
    const lookAhead = clampLookAhead(s);
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
