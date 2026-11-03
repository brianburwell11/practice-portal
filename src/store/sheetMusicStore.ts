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
  showPlayhead: boolean;
  /** Page view zoom: 1 = pages fit the width (or, reflowed, MuseScore's 100%). */
  pageZoom: number;
  /** Page view: white-on-dark pages. */
  pageInvert: boolean;
}

interface SheetMusicState extends Persisted {
  /** Sheet music full screen is open (not saved: every visit starts closed). */
  fullViewOpen: boolean;
  setFullViewOpen: (open: boolean) => void;
  setTrackingMode: (m: TrackingMode) => void;
  setScoreZoom: (z: number) => void;
  setWindowBars: (n: number) => void;
  setShowPlayhead: (v: boolean) => void;
  setPageZoom: (z: number) => void;
  setPageInvert: (v: boolean) => void;
}

export const PAGE_ZOOM_MIN = 0.5;
export const PAGE_ZOOM_MAX = 3;

const DEFAULTS: Persisted = {
  trackingMode: 'karaoke',
  scoreZoom: 0.95,
  windowBars: 4,
  showPlayhead: true,
  pageZoom: 1,
  pageInvert: false,
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
  fullViewOpen: false,
  setFullViewOpen: (open) => set({ fullViewOpen: open }),
  setTrackingMode: (m) => { set({ trackingMode: m }); persist(getPersisted(get())); },
  setScoreZoom: (z) => { set({ scoreZoom: z }); persist(getPersisted(get())); },
  setWindowBars: (n) => { set({ windowBars: n }); persist(getPersisted(get())); },
  setShowPlayhead: (v) => { set({ showPlayhead: v }); persist(getPersisted(get())); },
  setPageZoom: (z) => { set({ pageZoom: Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, z)) }); persist(getPersisted(get())); },
  setPageInvert: (v) => { set({ pageInvert: v }); persist(getPersisted(get())); },
}));

function getPersisted(s: SheetMusicState): Persisted {
  return {
    trackingMode: s.trackingMode,
    scoreZoom: s.scoreZoom,
    windowBars: s.windowBars,
    showPlayhead: s.showPlayhead,
    pageZoom: s.pageZoom,
    pageInvert: s.pageInvert,
  };
}
