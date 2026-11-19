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
  /** A span dragged out on the waveform: every marker inside it is selected */
  rangeSelection: { start: number; end: number } | null;
  undoStack: TapMapEntry[][];
  onComplete: ((tapMap: TapMapEntry[]) => void) | null;

  open: (tapMap: TapMapEntry[], onComplete?: (tapMap: TapMapEntry[]) => void) => void;
  close: () => void;
  addEntry: (entry: TapMapEntry) => void;
  deleteEntry: (index: number) => void;
  moveEntry: (index: number, newTime: number) => void;
  updateSectionLabel: (index: number, label: string) => void;
  updateEntryType: (index: number, type: TapMapEntry['type'], label?: string) => void;
  deleteEntriesWhere: (predicate: (entry: TapMapEntry) => boolean) => void;
  setSelectedIndex: (index: number | null) => void;
  setRangeSelection: (range: { start: number; end: number } | null) => void;
  /** Delete every marker in the range selection, as one undo step */
  deleteRangeSelection: () => void;
  undo: () => void;
  importTapMap: (entries: TapMapEntry[]) => void;
}

const initialState = {
  isOpen: false,
  tapMap: [] as TapMapEntry[],
  dirty: false,
  selectedIndex: null as number | null,
  rangeSelection: null as { start: number; end: number } | null,
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
      rangeSelection: null,
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

  updateEntryType: (index, type, label) =>
    set((state) => {
      const current = state.tapMap[index];
      if (!current || current.type === type) return state;
      const next: TapMapEntry =
        type === 'section'
          ? { time: current.time, type, label: label ?? current.label ?? '' }
          : { time: current.time, type };
      return {
        undoStack: pushUndo(state.undoStack, state.tapMap),
        tapMap: state.tapMap.map((e, i) => (i === index ? next : e)),
        dirty: true,
      };
    }),

  deleteEntriesWhere: (predicate) =>
    set((state) => {
      const selected =
        state.selectedIndex !== null ? state.tapMap[state.selectedIndex] : null;
      const next = state.tapMap.filter((e) => !predicate(e));
      if (next.length === state.tapMap.length) return state;
      const nextSelectedIndex =
        selected && !predicate(selected) ? next.indexOf(selected) : null;
      return {
        undoStack: pushUndo(state.undoStack, state.tapMap),
        tapMap: next,
        selectedIndex: nextSelectedIndex === -1 ? null : nextSelectedIndex,
        dirty: true,
      };
    }),

  setSelectedIndex: (index) => set({ selectedIndex: index, rangeSelection: null }),

  setRangeSelection: (range) => set({ rangeSelection: range, selectedIndex: null }),

  deleteRangeSelection: () =>
    set((state) => {
      const range = state.rangeSelection;
      if (!range) return state;
      const next = state.tapMap.filter((e) => e.time < range.start || e.time > range.end);
      if (next.length === state.tapMap.length) return { rangeSelection: null };
      return {
        undoStack: pushUndo(state.undoStack, state.tapMap),
        tapMap: next,
        rangeSelection: null,
        selectedIndex: null,
        dirty: true,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const stack = [...state.undoStack];
      const previous = stack.pop()!;
      return {
        undoStack: stack,
        tapMap: previous,
        rangeSelection: null,
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
