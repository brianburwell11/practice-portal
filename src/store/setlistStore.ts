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
  setIndex: (index: SetlistIndexEntry[]) => void;
  setActiveSetlist: (s: SetlistConfig | null) => void;
  setActiveIndex: (i: number) => void;
}

export const useSetlistStore = create<SetlistState>((set) => ({
  index: null,
  activeSetlist: null,
  activeIndex: 0,
  setIndex: (index) => set({ index }),
  setActiveSetlist: (activeSetlist) => set({ activeSetlist, activeIndex: 0 }),
  setActiveIndex: (activeIndex) => set({ activeIndex }),
}));
