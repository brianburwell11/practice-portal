import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

const MAX_UNDO = 50;

interface LyricsEditorState {
  isOpen: boolean;
  lines: LyricsLine[];
  dirty: boolean;
  undoStack: LyricsLine[][];
  redoStack: LyricsLine[][];
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
  redo: () => void;
  moveLineInDirection: (direction: 'up' | 'down') => void;
  duplicateLines: () => void;
  selectAll: () => void;
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
  redoStack: [] as LyricsLine[][],
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
      redoStack: [],
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
        redoStack: [],
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
        redoStack: [],
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
        redoStack: [],
        lines: updated,
        currentSyncIndex: nextNonBlankIndex(updated, index + 1),
        dirty: true,
      };
    }),

  moveLine: (index, time) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.lines),
      redoStack: [],
      lines: state.lines.map((l, i) =>
        i === index ? { ...l, time } : l,
      ),
      dirty: true,
    })),

  unsyncLine: (index) =>
    set((state) => ({
      undoStack: pushUndo(state.undoStack, state.lines),
      redoStack: [],
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
        redoStack: [],
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
        redoStack: [],
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
        redoStack: [],
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
        redoStack: pushUndo(state.redoStack, state.lines),
        lines: previous,
        currentSyncIndex: nextNonBlankIndex(previous, 0),
        dirty: true,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const stack = [...state.redoStack];
      const next = stack.pop()!;
      return {
        redoStack: stack,
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: next,
        currentSyncIndex: nextNonBlankIndex(next, 0),
        dirty: true,
      };
    }),

  moveLineInDirection: (direction) =>
    set((state) => {
      const indices = state.focusedIndex !== null
        ? [state.focusedIndex]
        : [...state.selectedIndices].sort((a, b) => a - b);
      if (indices.length === 0) return state;

      const min = indices[0];
      const max = indices[indices.length - 1];
      if (direction === 'up' && min === 0) return state;
      if (direction === 'down' && max === state.lines.length - 1) return state;

      const delta = direction === 'up' ? -1 : 1;
      const newLines = [...state.lines];
      const ordered = direction === 'up' ? indices : [...indices].reverse();
      for (const idx of ordered) {
        [newLines[idx], newLines[idx + delta]] = [newLines[idx + delta], newLines[idx]];
      }

      const movedSet = new Set(indices);
      let newSyncIndex = state.currentSyncIndex;
      if (movedSet.has(state.currentSyncIndex)) {
        newSyncIndex = state.currentSyncIndex + delta;
      } else if (direction === 'up' && state.currentSyncIndex === min - 1) {
        newSyncIndex = state.currentSyncIndex + indices.length;
      } else if (direction === 'down' && state.currentSyncIndex === max + 1) {
        newSyncIndex = state.currentSyncIndex - indices.length;
      }

      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        redoStack: [],
        lines: newLines,
        dirty: true,
        focusedIndex: state.focusedIndex !== null ? state.focusedIndex + delta : null,
        selectedIndices: new Set([...state.selectedIndices].map((i) => i + delta)),
        currentSyncIndex: Math.max(0, Math.min(newLines.length - 1, newSyncIndex)),
      };
    }),

  duplicateLines: () =>
    set((state) => {
      const indices = state.focusedIndex !== null
        ? [state.focusedIndex]
        : [...state.selectedIndices].sort((a, b) => a - b);
      if (indices.length === 0) return state;

      const copies = indices.map((i) => ({ ...state.lines[i], time: null }));
      const insertAfter = indices[indices.length - 1];
      const newLines = [
        ...state.lines.slice(0, insertAfter + 1),
        ...copies,
        ...state.lines.slice(insertAfter + 1),
      ];

      const newSyncIdx = insertAfter + 1 <= state.currentSyncIndex
        ? state.currentSyncIndex + copies.length
        : state.currentSyncIndex;

      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        redoStack: [],
        lines: newLines,
        dirty: true,
        currentSyncIndex: newSyncIdx,
        focusedIndex: state.focusedIndex !== null ? insertAfter + 1 : null,
        selectedIndices: state.focusedIndex === null
          ? new Set(copies.map((_, j) => insertAfter + 1 + j))
          : new Set<number>(),
      };
    }),

  selectAll: () =>
    set((state) => ({
      selectedIndices: new Set(state.lines.map((_, i) => i)),
    })),
}));
