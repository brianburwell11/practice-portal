import { useEffect, useSyncExternalStore } from 'react';

/**
 * Shared tapMap offset across every sheet-music widget on the page.
 *
 * Widget 0 (TapMapBlinker) has a nudge slider so the reader can empirically
 * align the tapMap with the audio. Once they find the right value there,
 * every other widget should use it — so time→beat mapping is consistent.
 *
 * This is a module-level singleton; Astro renders each `client:only="react"`
 * island separately, but Vite deduplicates the chunk so all islands share
 * the same module instance at runtime. A localStorage round-trip also
 * persists the value across reloads.
 *
 * The offset is applied as `effectiveTime = audio.currentTime + offsetSec`
 * before mapping to a score-beat. Positive offset = the tapMap was tapped
 * late relative to the audio (so we pretend the audio is already a bit
 * further along, which makes markers fire earlier).
 */

const STORAGE_KEY = 'tapmap-offset-sec';

function loadInitial(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw == null) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

let offset = loadInitial();
const listeners = new Set<() => void>();

export function getTapMapOffset(): number {
  return offset;
}

export function setTapMapOffset(n: number): void {
  if (n === offset) return;
  offset = n;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(STORAGE_KEY, String(n)); } catch { /* quota, private mode */ }
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Hook form — returns the live offset and a setter. Re-renders any widget
 * that reads it whenever any other widget writes it.
 */
export function useTapMapOffset(): [number, (n: number) => void] {
  const current = useSyncExternalStore(subscribe, getTapMapOffset, getTapMapOffset);
  // Re-read localStorage on mount in case another tab wrote a value (rare
  // — only matters if the reader has two tabs open on this docs page).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const n = e.newValue != null ? parseFloat(e.newValue) : 0;
      if (Number.isFinite(n)) setTapMapOffset(n);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return [current, setTapMapOffset];
}
