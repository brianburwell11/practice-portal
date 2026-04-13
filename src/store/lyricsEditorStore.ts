import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

const MAX_UNDO = 50;

interface LyricsEditorState {
  isOpen: boolean;
  lines: LyricsLine[];
  dirty: boolean;
  undoStack: LyricsLine[][];
  currentSyncIndex: number;
  selectedIndices: Set<number>;
  focusedIndex: number | null;

  open: (lines: LyricsLine[]) => void;
  close: () => void;
  updateLine: (index: number, text: string) => void;
  insertLineAfter: (index: number, line?: LyricsLine) => void;
  insertLines: (index: number, newLines: LyricsLine[]) => void;
  syncLine: (index: number, time: number) => void;
  moveLine: (index: number, time: number) => void;
  unsyncLine: (index: number) => void;
  unsyncSelected: () => void;
  deleteSelected: () => void;
  deleteLine: (index: number) => void;
  setCurrentSyncIndex: (index: number) => void;
  setSelectedIndices: (indices: Set<number>) => void;
  setFocusedIndex: (index: number | null) => void;
  undo: () => void;
}

function nextNonBlankIndex(lines: LyricsLine[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].text !== '' || lines[i].instrumental) return i;
  }
  return lines.length;
}

function pushUndo(stack: LyricsLine[][], snapshot: LyricsLine[]): LyricsLine[][] {
  const next = [...stack, snapshot];
  if (next.length > MAX_UNDO) next.shift();
  return next;
}

const initialState = {
  isOpen: false,
  lines: [] as LyricsLine[],
  dirty: false,
  undoStack: [] as LyricsLine[][],
  currentSyncIndex: 0,
  selectedIndices: new Set<number>(),
  focusedIndex: null as number | null,
};

export const useLyricsEditorStore = create<LyricsEditorState>((set) => ({
  ...initialState,

  open: (lines) => {
    // Ensure at least one empty row to start editing
    const initial = lines.length > 0 ? lines : [{ text: '', time: null }];
    set({
      isOpen: true,
      lines: initial,
      dirty: false,
      undoStack: [],
      currentSyncIndex: nextNonBlankIndex(initial, 0),
      selectedIndices: new Set<number>(),
      focusedIndex: null,
    });
  },

  close: () => set({ ...initialState, selectedIndices: new Set<number>() }),

  updateLine: (index, text) =>
    set((state) => {
      const updated = state.lines.map((l, i) =>
        i === index ? { ...l, text, instrumental: false } : l,
      );
      return { lines: updated, dirty: true };
    }),

  insertLineAfter: (index, line) =>
    set((state) => {
      const newLine = line ?? { text: '', time: null };
      const updated = [
        ...state.lines.slice(0, index + 1),
        newLine,
        ...state.lines.slice(index + 1),
      ];
      // Adjust currentSyncIndex if insertion was at or before it
      const newSyncIdx = index + 1 <= state.currentSyncIndex
        ? state.currentSyncIndex + 1
        : state.currentSyncIndex;
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentSyncIndex: newSyncIdx,
        dirty: true,
      };
    }),

  insertLines: (index, newLines) =>
    set((state) => {
      const updated = [
        ...state.lines.slice(0, index + 1),
        ...newLines,
        ...state.lines.slice(index + 1),
      ];
      const newSyncIdx = index + 1 <= state.currentSyncIndex
        ? state.currentSyncIndex + newLines.length
        : state.currentSyncIndex;
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentSyncIndex: newSyncIdx,
        dirty: true,
      };
    }),

  syncLine: (index, time) =>
    set((state) => {
      const updated = state.lines.map((l, i) =>
        i === index ? { ...l, time } : l,
      );
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentSyncIndex: nextNonBlankIndex(updated, index + 1),
        dirty: true,
      };
    }),

  moveLine: (index, time) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.lines),
      lines: state.lines.map((l, i) =>
        i === index ? { ...l, time } : l,
      ),
      dirty: true,
    })),

  unsyncLine: (index) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.lines),
      lines: state.lines.map((l, i) =>
        i === index ? { ...l, time: null } : l,
      ),
      dirty: true,
    })),

  unsyncSelected: () =>
    set((state) => {
      if (state.selectedIndices.size === 0) return state;
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: state.lines.map((l, i) =>
          state.selectedIndices.has(i) ? { ...l, time: null } : l,
        ),
        selectedIndices: new Set<number>(),
        dirty: true,
      };
    }),

  deleteSelected: () =>
    set((state) => {
      if (state.selectedIndices.size === 0) return state;
      const updated = state.lines.filter((_, i) => !state.selectedIndices.has(i));
      const final = updated.length > 0 ? updated : [{ text: '', time: null }];
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: final,
        currentSyncIndex: Math.min(state.currentSyncIndex, final.length - 1),
        selectedIndices: new Set<number>(),
        dirty: true,
      };
    }),

  deleteLine: (index) =>
    set((state) => {
      const updated = state.lines.filter((_, i) => i !== index);
      const final = updated.length > 0 ? updated : [{ text: '', time: null }];
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: final,
        currentSyncIndex: Math.min(state.currentSyncIndex, final.length - 1),
        selectedIndices: new Set<number>(),
        dirty: true,
      };
    }),

  setCurrentSyncIndex: (index) => set({ currentSyncIndex: index }),

  setSelectedIndices: (indices) => set({ selectedIndices: indices }),

  setFocusedIndex: (index) => set({ focusedIndex: index }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const stack = [...state.undoStack];
      const previous = stack.pop()!;
      return {
        undoStack: stack,
        lines: previous,
        currentSyncIndex: nextNonBlankIndex(previous, 0),
        dirty: true,
      };
    }),
}));
