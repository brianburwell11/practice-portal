import { create } from 'zustand';

/** The listener's correction to the output latency the browser reports, in
 *  milliseconds. Per device: Bluetooth headphones on one machine say nothing
 *  about another, so this stays in localStorage and never syncs. */
export const MIN_LATENCY_ADJUST_MS = -100;
export const MAX_LATENCY_ADJUST_MS = 400;

const ADJUST_KEY = 'practice-portal.outputLatencyAdjustMs';

function clampAdjust(n: number): number {
  return Math.round(Math.max(MIN_LATENCY_ADJUST_MS, Math.min(MAX_LATENCY_ADJUST_MS, n)));
}

function loadAdjust(): number {
  try {
    const raw = window.localStorage.getItem(ADJUST_KEY);
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) ? clampAdjust(n) : 0;
  } catch {
    return 0;
  }
}

interface LatencyState {
  adjustMs: number;
  /** Clamped to MIN_LATENCY_ADJUST_MS..MAX_LATENCY_ADJUST_MS. */
  setAdjustMs: (ms: number) => void;
}

export const useLatencyStore = create<LatencyState>((set) => ({
  adjustMs: typeof window === 'undefined' ? 0 : loadAdjust(),
  setAdjustMs: (ms) => {
    const adjustMs = clampAdjust(ms);
    try {
      window.localStorage.setItem(ADJUST_KEY, String(adjustMs));
    } catch { /* private mode */ }
    set({ adjustMs });
  },
}));
