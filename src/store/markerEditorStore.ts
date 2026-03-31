import { create } from 'zustand';
import type { MarkerConfig } from '../audio/types';

interface MarkerEditorState {
  isOpen: boolean;
  markers: MarkerConfig[];
  beatOffset: number;
  editingMarkerIndex: number | null;
  tapBeatMode: boolean;
  dirty: boolean;

  open: (markers: MarkerConfig[], beatOffset: number) => void;
  close: () => void;
  addMarker: (marker: MarkerConfig) => void;
  updateMarker: (index: number, updates: Partial<MarkerConfig>) => void;
  deleteMarker: (index: number) => void;
  moveMarker: (index: number, newBeat: number) => void;
  setEditingMarker: (index: number | null) => void;
  setBeatOffset: (offset: number) => void;
  setTapBeatMode: (on: boolean) => void;
}

const initialState = {
  isOpen: false,
  markers: [] as MarkerConfig[],
  beatOffset: 0,
  editingMarkerIndex: null as number | null,
  tapBeatMode: false,
  dirty: false,
};

export const useMarkerEditorStore = create<MarkerEditorState>((set) => ({
  ...initialState,

  open: (markers, beatOffset) =>
    set({
      isOpen: true,
      markers: [...markers].sort((a, b) => a.beat - b.beat),
      beatOffset,
      editingMarkerIndex: null,
      tapBeatMode: false,
      dirty: false,
    }),

  close: () => set({ ...initialState }),

  addMarker: (marker) =>
    set((state) => ({
      markers: [...state.markers, marker].sort((a, b) => a.beat - b.beat),
      dirty: true,
    })),

  updateMarker: (index, updates) =>
    set((state) => ({
      markers: state.markers.map((m, i) =>
        i === index ? { ...m, ...updates } : m,
      ),
      dirty: true,
    })),

  deleteMarker: (index) =>
    set((state) => ({
      markers: state.markers.filter((_, i) => i !== index),
      editingMarkerIndex:
        state.editingMarkerIndex === index ? null : state.editingMarkerIndex,
      dirty: true,
    })),

  moveMarker: (index, newBeat) =>
    set((state) => {
      const moved = { ...state.markers[index], beat: newBeat };
      const rest = state.markers.filter((_, i) => i !== index);
      const sorted = [...rest, moved].sort((a, b) => a.beat - b.beat);
      const newIndex = sorted.indexOf(moved);
      return {
        markers: sorted,
        editingMarkerIndex: newIndex,
        dirty: true,
      };
    }),

  setEditingMarker: (index) => set({ editingMarkerIndex: index }),

  setBeatOffset: (beatOffset) => set({ beatOffset, dirty: true }),

  setTapBeatMode: (tapBeatMode) => set({ tapBeatMode }),
}));
