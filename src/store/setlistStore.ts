import { create } from 'zustand';
import type { SetlistConfig } from '../audio/types';

export interface SetlistIndexEntry {
  id: string;
  slug?: string;
  name: string;
}

interface SetlistState {
  index: SetlistIndexEntry[] | null;
  activeSetlist: SetlistConfig | null;
  activeIndex: number;
  /**
   * The collection being browsed: a song tag, in `?tag=`. Unordered, unlike
   * a setlist, and only one of the two is active at a time.
   */
  activeTag: string | null;
  setIndex: (index: SetlistIndexEntry[]) => void;
  setActiveSetlist: (s: SetlistConfig | null) => void;
  setActiveIndex: (i: number) => void;
  setActiveTag: (tag: string | null) => void;
}

export const useSetlistStore = create<SetlistState>((set) => ({
  index: null,
  activeSetlist: null,
  activeIndex: 0,
  activeTag: null,
  setIndex: (index) => set({ index }),
  setActiveSetlist: (activeSetlist) => set((s) => ({ activeSetlist, activeIndex: 0, activeTag: activeSetlist ? null : s.activeTag })),
  setActiveIndex: (activeIndex) => set({ activeIndex }),
  setActiveTag: (activeTag) => set((s) => ({ activeTag, activeSetlist: activeTag ? null : s.activeSetlist, activeIndex: 0 })),
}));
