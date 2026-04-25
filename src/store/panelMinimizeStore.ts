import { create } from 'zustand';

export type PanelId = 'sheet' | 'mixer' | 'lyrics';

export type MinimizedItem =
  | { kind: 'panel'; id: PanelId }
  | { kind: 'video'; id: string };

interface PanelMinimizeState {
  items: MinimizedItem[];
  /** ID of the currently-loaded song. Used to scope per-song persisted
   *  state (right now: which videos were minimized last visit). */
  currentSongId: string | null;
  minimizePanel: (id: PanelId) => void;
  restorePanel: (id: PanelId) => void;
  minimizeVideo: (id: string) => void;
  restoreVideo: (id: string) => void;
  isPanelMinimized: (id: PanelId) => boolean;
  isVideoMinimized: (id: string) => boolean;
  /** Switch the active song. Drops any video chips from the previous song
   *  and replaces them with whichever videos the user had minimized last
   *  time they viewed `songId` (loaded from localStorage). */
  setCurrentSongId: (songId: string | null) => void;
  clearAll: () => void;
}

const STORAGE_KEY = 'practice-portal.minimizedVideos';

function loadMinimizedVideos(songId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const ids = parsed[songId];
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function saveMinimizedVideos(songId: string, videoIds: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    if (videoIds.length === 0) {
      delete parsed[songId];
    } else {
      parsed[songId] = videoIds;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* quota / private mode */ }
}

function videoIdsFromItems(items: MinimizedItem[]): string[] {
  return items.filter((x) => x.kind === 'video').map((x) => x.id);
}

export const usePanelMinimizeStore = create<PanelMinimizeState>((set, get) => ({
  items: [],
  currentSongId: null,
  minimizePanel: (id) =>
    set((s) => {
      if (s.items.some((x) => x.kind === 'panel' && x.id === id)) return s;
      return { items: [...s.items, { kind: 'panel', id }] };
    }),
  restorePanel: (id) =>
    set((s) => ({
      items: s.items.filter((x) => !(x.kind === 'panel' && x.id === id)),
    })),
  minimizeVideo: (id) =>
    set((s) => {
      if (s.items.some((x) => x.kind === 'video' && x.id === id)) return s;
      const items: MinimizedItem[] = [...s.items, { kind: 'video', id }];
      if (s.currentSongId) saveMinimizedVideos(s.currentSongId, videoIdsFromItems(items));
      return { items };
    }),
  restoreVideo: (id) =>
    set((s) => {
      const items = s.items.filter((x) => !(x.kind === 'video' && x.id === id));
      if (s.currentSongId) saveMinimizedVideos(s.currentSongId, videoIdsFromItems(items));
      return { items };
    }),
  isPanelMinimized: (id) =>
    get().items.some((x) => x.kind === 'panel' && x.id === id),
  isVideoMinimized: (id) =>
    get().items.some((x) => x.kind === 'video' && x.id === id),
  setCurrentSongId: (songId) =>
    set((s) => {
      const nonVideoItems = s.items.filter((x) => x.kind !== 'video');
      const restored: MinimizedItem[] = songId
        ? loadMinimizedVideos(songId).map((id) => ({ kind: 'video', id }))
        : [];
      return {
        currentSongId: songId,
        items: [...nonVideoItems, ...restored],
      };
    }),
  clearAll: () => set({ items: [] }),
}));
