import { create } from 'zustand';
import type { TapMapEntry } from '../audio/types';

const MAX_UNDO = 50;

const sortByTime = (entries: TapMapEntry[]) =>
  [...entries].sort((a, b) => a.time - b.time);

interface TapMapEditorState {
  isOpen: boolean;
  tapMap: TapMapEntry[];
  dirty: boolean;
  selectedIndex: number | null;
  tapping: boolean;
  undoStack: TapMapEntry[][];
  onComplete: ((tapMap: TapMapEntry[]) => void) | null;

  open: (tapMap: TapMapEntry[], onComplete?: (tapMap: TapMapEntry[]) => void) => void;
  close: () => void;
  addEntry: (entry: TapMapEntry) => void;
  deleteEntry: (index: number) => void;
  moveEntry: (index: number, newTime: number) => void;
  updateSectionLabel: (index: number, label: string) => void;
  setSelectedIndex: (index: number | null) => void;
  setTapping: (on: boolean) => void;
  undo: () => void;
  importTapMap: (entries: TapMapEntry[]) => void;
}

const initialState = {
  isOpen: false,
  tapMap: [] as TapMapEntry[],
  dirty: false,
  selectedIndex: null as number | null,
  tapping: false,
  undoStack: [] as TapMapEntry[][],
  onComplete: null as ((tapMap: TapMapEntry[]) => void) | null,
};

const pushUndo = (stack: TapMapEntry[][], snapshot: TapMapEntry[]): TapMapEntry[][] => {
  const next = [...stack, snapshot];
  if (next.length > MAX_UNDO) next.shift();
  return next;
};

export const useMarkerEditorStore = create<TapMapEditorState>((set) => ({
  ...initialState,

  open: (tapMap, onComplete) =>
    set({
      isOpen: true,
      tapMap: sortByTime(tapMap),
      dirty: false,
      selectedIndex: null,
      tapping: false,
      undoStack: [],
      onComplete: onComplete ?? null,
    }),

  close: () => set({ ...initialState }),

  addEntry: (entry) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.tapMap),
      tapMap: sortByTime([...state.tapMap, entry]),
      dirty: true,
    })),

  deleteEntry: (index) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.tapMap),
      tapMap: state.tapMap.filter((_, i) => i !== index),
      selectedIndex: state.selectedIndex === index ? null : state.selectedIndex,
      dirty: true,
    })),

  moveEntry: (index, newTime) =>
    set((state) => {
      const moved = { ...state.tapMap[index], time: newTime };
      const rest = state.tapMap.filter((_, i) => i !== index);
      const sorted = sortByTime([...rest, moved]);
      const newIndex = sorted.indexOf(moved);
      return {
        undoStack: pushUndo(state.undoStack, state.tapMap),
        tapMap: sorted,
        selectedIndex: newIndex,
        dirty: true,
      };
    }),

  updateSectionLabel: (index, label) =>
    set((state) => ({
      tapMap: state.tapMap.map((e, i) =>
        i === index ? { ...e, label } : e,
      ),
      dirty: true,
    })),

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  setTapping: (tapping) => set({ tapping }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const stack = [...state.undoStack];
      const previous = stack.pop()!;
      return {
        undoStack: stack,
        tapMap: previous,
        dirty: true,
      };
    }),

  importTapMap: (entries) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.tapMap),
      tapMap: sortByTime(entries),
      dirty: true,
    })),
}));
