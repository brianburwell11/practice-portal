import { create } from 'zustand';

/**
 * Persistent per-user preferences for the scrolling sheet-music panel.
 * Ported from the docs-site prototype's Shipping Decisions: only three
 * knobs reach the user. Everything else (cursor granularity, playhead
 * height, snappiness, bbox anchor) is locked in at the call sites.
 */

export type TrackingMode = 'karaoke' | 'window';

const STORAGE_KEY = 'practice-portal.sheetMusic';

interface Persisted {
  trackingMode: TrackingMode;
  scoreZoom: number;
  windowBars: number;
  equalBeatWidthOverride: boolean | null; // null = follow song config
  showPlayhead: boolean;
}

interface SheetMusicState extends Persisted {
  setTrackingMode: (m: TrackingMode) => void;
  setScoreZoom: (z: number) => void;
  setWindowBars: (n: number) => void;
  setEqualBeatWidthOverride: (v: boolean | null) => void;
  setShowPlayhead: (v: boolean) => void;
}

const DEFAULTS: Persisted = {
  trackingMode: 'karaoke',
  scoreZoom: 0.95,
  windowBars: 4,
  equalBeatWidthOverride: null,
  showPlayhead: true,
};

function loadInitial(): Persisted {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: Persisted): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota / private mode */ }
}

export const useSheetMusicStore = create<SheetMusicState>((set, get) => ({
  ...loadInitial(),
  setTrackingMode: (m) => { set({ trackingMode: m }); persist(getPersisted(get())); },
  setScoreZoom: (z) => { set({ scoreZoom: z }); persist(getPersisted(get())); },
  setWindowBars: (n) => { set({ windowBars: n }); persist(getPersisted(get())); },
  setEqualBeatWidthOverride: (v) => { set({ equalBeatWidthOverride: v }); persist(getPersisted(get())); },
  setShowPlayhead: (v) => { set({ showPlayhead: v }); persist(getPersisted(get())); },
}));

function getPersisted(s: SheetMusicState): Persisted {
  return {
    trackingMode: s.trackingMode,
    scoreZoom: s.scoreZoom,
    windowBars: s.windowBars,
    equalBeatWidthOverride: s.equalBeatWidthOverride,
    showPlayhead: s.showPlayhead,
  };
}
