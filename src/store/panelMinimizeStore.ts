import { create } from 'zustand';

export type PanelId = 'sheet' | 'mixer' | 'lyrics';

export type MinimizedItem =
  | { kind: 'panel'; id: PanelId }
  | { kind: 'video'; id: string };

interface PanelMinimizeState {
  items: MinimizedItem[];
  minimizePanel: (id: PanelId) => void;
  restorePanel: (id: PanelId) => void;
  minimizeVideo: (id: string) => void;
  restoreVideo: (id: string) => void;
  isPanelMinimized: (id: PanelId) => boolean;
  isVideoMinimized: (id: string) => boolean;
  clearAll: () => void;
}

function sameItem(a: MinimizedItem, b: MinimizedItem): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export const usePanelMinimizeStore = create<PanelMinimizeState>((set, get) => ({
  items: [],
  minimizePanel: (id) =>
    set((s) => {
      const item: MinimizedItem = { kind: 'panel', id };
      return s.items.some((x) => sameItem(x, item))
        ? s
        : { items: [...s.items, item] };
    }),
  restorePanel: (id) =>
    set((s) => ({
      items: s.items.filter((x) => !(x.kind === 'panel' && x.id === id)),
    })),
  minimizeVideo: (id) =>
    set((s) => {
      const item: MinimizedItem = { kind: 'video', id };
      return s.items.some((x) => sameItem(x, item))
        ? s
        : { items: [...s.items, item] };
    }),
  restoreVideo: (id) =>
    set((s) => ({
      items: s.items.filter((x) => !(x.kind === 'video' && x.id === id)),
    })),
  isPanelMinimized: (id) =>
    get().items.some((x) => x.kind === 'panel' && x.id === id),
  isVideoMinimized: (id) =>
    get().items.some((x) => x.kind === 'video' && x.id === id),
  clearAll: () => set({ items: [] }),
}));
