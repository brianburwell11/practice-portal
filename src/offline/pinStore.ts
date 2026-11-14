import { create } from 'zustand';
import { allPins, type Pin } from '../../sw/store';
import type { SetlistConfig, SongManifestEntry } from '../audio/types';
import { pinSetlist, pinSong, refreshPins, unpin, type PinProgress } from './pin';
import { OFFLINE_CACHE_ENABLED } from './offline';

/**
 * What's "Available offline" on this device, and what's downloading. The
 * pins themselves live in IndexedDB (`sw/store.ts`); this mirrors them for
 * the UI and runs the downloads.
 */
interface PinState {
  loaded: boolean;
  pins: Record<string, Pin>;
  /** Downloads in progress, by pin id. */
  progress: Record<string, PinProgress>;
  /** The last download's failure, by pin id. */
  errors: Record<string, string>;
  load: () => Promise<void>;
  pinSong: (band: string, entry: SongManifestEntry) => Promise<void>;
  pinSetlist: (band: string, setlist: SetlistConfig) => Promise<void>;
  unpin: (id: string) => Promise<void>;
  /** Re-download every pin, quietly (after the app has reached the server). */
  refresh: () => Promise<void>;
}

const without = <T,>(map: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...map };
  delete next[key];
  return next;
};

export const usePinStore = create<PinState>((set, get) => {
  /** Run one pin's download, tracking its progress and outcome. */
  const run = async (id: string, label: string, band: string, kind: Pin['kind'], start: (onProgress: (p: PinProgress) => void) => Promise<Pin>) => {
    if (get().progress[id]) return;
    set((s) => ({
      progress: { ...s.progress, [id]: { done: 0, total: 0 } },
      errors: without(s.errors, id),
      // Shown as pinned straight away, while it downloads.
      pins: s.pins[id] ? s.pins : { ...s.pins, [id]: { id, kind, band, target: '', label, songs: [], ready: false, pinnedAt: Date.now() } },
    }));
    try {
      const pin = await start((p) => set((s) => ({ progress: { ...s.progress, [id]: p } })));
      set((s) => ({ pins: { ...s.pins, [id]: pin } }));
    } catch (err) {
      set((s) => ({ errors: { ...s.errors, [id]: (err as Error).message } }));
      // Keep whatever IndexedDB has (a pin that never finished stays, not ready).
      const stored = (await allPins().catch(() => [])).find((p) => p.id === id);
      set((s) => ({ pins: stored ? { ...s.pins, [id]: stored } : without(s.pins, id) }));
    } finally {
      set((s) => ({ progress: without(s.progress, id) }));
    }
  };

  return {
    loaded: false,
    pins: {},
    progress: {},
    errors: {},

    load: async () => {
      if (!OFFLINE_CACHE_ENABLED || get().loaded) return;
      const pins = await allPins().catch(() => []);
      set({ loaded: true, pins: Object.fromEntries(pins.map((p) => [p.id, p])) });
    },

    pinSong: (band, entry) => run(`song:${band}/${entry.id}`, entry.title, band, 'song', (onProgress) => pinSong(band, entry, onProgress)),

    pinSetlist: (band, setlist) => run(`setlist:${band}/${setlist.id}`, setlist.name, band, 'setlist', (onProgress) => pinSetlist(band, setlist, onProgress)),

    unpin: async (id) => {
      await unpin(id);
      set((s) => ({ pins: without(s.pins, id), errors: without(s.errors, id) }));
    },

    refresh: async () => {
      await get().load();
      await refreshPins((pin) => set((s) => ({ pins: { ...s.pins, [pin.id]: pin } })));
    },
  };
});
