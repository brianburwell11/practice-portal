import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';

const MAX_UNDO = 50;

interface LyricsEditorState {
  isOpen: boolean;
  step: 'input' | 'sync';
  lines: LyricsLine[];
  rawText: string;
  dirty: boolean;
  undoStack: LyricsLine[][];
  currentLineIndex: number;
  selectedIndices: Set<number>;

  open: (lines: LyricsLine[]) => void;
  close: () => void;
  setStep: (step: 'input' | 'sync') => void;
  setRawText: (text: string) => void;
  syncLine: (index: number, time: number) => void;
  markInstrumental: (time: number) => void;
  unsyncLine: (index: number) => void;
  unsyncSelected: () => void;
  deleteSelected: () => void;
  deleteLine: (index: number) => void;
  setCurrentLineIndex: (index: number) => void;
  setSelectedIndices: (indices: Set<number>) => void;
  undo: () => void;
}

function linesToText(lines: LyricsLine[]): string {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.instrumental) {
      // Add blank line before if previous line isn't already blank
      if (result.length > 0 && result[result.length - 1] !== '') {
        result.push('');
      }
      result.push('[Instrumental]');
      // Add blank line after if next line isn't already blank
      const next = lines[i + 1];
      if (next && next.text !== '' && !next.instrumental) {
        result.push('');
      }
    } else {
      result.push(l.text);
    }
  }
  return result.join('\n');
}

function textToLines(text: string, stripBlanks: boolean): LyricsLine[] {
  const rows = text.split('\n');
  const filtered = stripBlanks ? rows.filter((line) => line.trim().length > 0) : rows;
  return filtered.map((line) => {
    if (/^\[instrumental\]$/i.test(line.trim())) {
      return { text: '', time: null, instrumental: true };
    }
    return { text: line.trim(), time: null };
  });
}

function isLyric(line: LyricsLine): boolean {
  return !line.instrumental && line.text !== '';
}

function nextLyricIndex(lines: LyricsLine[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (isLyric(lines[i])) return i;
  }
  return Math.max(0, lines.length - 1);
}

function pushUndo(stack: LyricsLine[][], snapshot: LyricsLine[]): LyricsLine[][] {
  const next = [...stack, snapshot];
  if (next.length > MAX_UNDO) next.shift();
  return next;
}

const initialState = {
  isOpen: false,
  step: 'input' as const,
  lines: [] as LyricsLine[],
  rawText: '',
  dirty: false,
  undoStack: [] as LyricsLine[][],
  currentLineIndex: 0,
  selectedIndices: new Set<number>(),
};

export const useLyricsEditorStore = create<LyricsEditorState>((set) => ({
  ...initialState,

  open: (lines) =>
    set({
      isOpen: true,
      step: 'input',
      lines,
      rawText: lines.length > 0 ? linesToText(lines) : '',
      dirty: false,
      undoStack: [],
      currentLineIndex: 0,
    }),

  close: () => set({ ...initialState }),

  setStep: (step) =>
    set((state) => {
      if (step === 'sync' && state.step === 'input') {
        // Parse text into lines, preserving existing sync times where text matches
        const newLines = textToLines(state.rawText, false);
        const oldByText = new Map<string, LyricsLine>();
        for (const l of state.lines) {
          const key = l.instrumental ? '[instrumental]' : l.text.toLowerCase();
          if (!oldByText.has(key)) oldByText.set(key, l);
        }
        const merged = newLines.map((nl) => {
          const key = nl.instrumental ? '[instrumental]' : nl.text.toLowerCase();
          const old = oldByText.get(key);
          if (old && old.time !== null) {
            oldByText.delete(key);
            return { ...nl, time: old.time };
          }
          return nl;
        });
        return {
          step: 'sync',
          lines: merged,
          currentLineIndex: nextLyricIndex(merged, 0),
        };
      }
      if (step === 'input' && state.step === 'sync') {
        return {
          step: 'input',
          rawText: linesToText(state.lines),
        };
      }
      return { step };
    }),

  setRawText: (text) => set({ rawText: text, dirty: true }),

  syncLine: (index, time) =>
    set((state) => {
      const updated = state.lines.map((l, i) =>
        i === index ? { ...l, time } : l,
      );
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentLineIndex: nextLyricIndex(updated, index + 1),
        dirty: true,
      };
    }),

  markInstrumental: (time) =>
    set((state) => {
      const marker: LyricsLine = { text: '', time, instrumental: true };
      // Insert after the last synced line whose time <= marker time
      let insertAt = 0;
      for (let i = 0; i < state.lines.length; i++) {
        if (state.lines[i].time !== null && state.lines[i].time! <= time) {
          insertAt = i + 1;
        }
      }
      const updated = [
        ...state.lines.slice(0, insertAt),
        marker,
        ...state.lines.slice(insertAt),
      ];
      // Advance to the next lyric after the inserted instrumental
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentLineIndex: nextLyricIndex(updated, insertAt + 1),
        dirty: true,
      };
    }),

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
      const newIndex = Math.min(state.currentLineIndex, Math.max(0, updated.length - 1));
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentLineIndex: newIndex,
        selectedIndices: new Set<number>(),
        dirty: true,
      };
    }),

  deleteLine: (index) =>
    set((state) => {
      const updated = state.lines.filter((_, i) => i !== index);
      const newIndex = Math.min(state.currentLineIndex, Math.max(0, updated.length - 1));
      return {
        undoStack: pushUndo(state.undoStack, state.lines),
        lines: updated,
        currentLineIndex: newIndex,
        selectedIndices: new Set<number>(),
        dirty: true,
      };
    }),

  setCurrentLineIndex: (index) => set({ currentLineIndex: index }),

  setSelectedIndices: (indices) => set({ selectedIndices: indices }),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const stack = [...state.undoStack];
      const previous = stack.pop()!;
      return {
        undoStack: stack,
        lines: previous,
        currentLineIndex: nextLyricIndex(previous, 0),
        dirty: true,
      };
    }),
}));
