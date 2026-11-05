import { create } from 'zustand';
import type { LyricsLine } from '../audio/lyricsTypes';
import { END_MARKER, isAdminAnnotation, isInstrumentalAnnotation } from '../audio/lyricSections';

const MAX_UNDO = 50;

export type LyricsEditorMode = 'lyrics' | 'timing';

/** An undo step: the lines plus where the sync cursor was, so undo puts
 *  you back on the line you were timing rather than at the top. */
interface Snapshot {
  lines: LyricsLine[];
  currentSyncIndex: number;
}

interface LyricsEditorState {
  isOpen: boolean;
  /** Lyrics = edit the words in a text box. Timing = stamp and tune times. */
  mode: LyricsEditorMode;
  lines: LyricsLine[];
  dirty: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  /** The next line to stamp. */
  currentSyncIndex: number;
  /** The line the nudge and replay controls act on. */
  reviewIndex: number | null;

  open: (lines: LyricsLine[]) => void;
  close: () => void;
  setMode: (mode: LyricsEditorMode) => void;
  /** Replace the lines from the text box. No undo step: entering Lyrics
   *  mode pushed one for the whole editing session. */
  replaceLines: (lines: LyricsLine[]) => void;
  /** Replace the lines from an import, as one undo step. */
  importLines: (lines: LyricsLine[]) => void;
  syncLine: (index: number, time: number) => void;
  /** Add an end-of-lyrics marker after the last line, timed at `time`. */
  cueEnd: (time: number) => void;
  /** Step the sync target back to the previous stampable line and clear its time. */
  stepBack: () => void;
  moveLine: (index: number, time: number) => void;
  nudgeLine: (index: number, delta: number) => void;
  /** Point the sync cursor (and the review line) at a row. */
  selectLine: (index: number) => void;
  undo: () => void;
  redo: () => void;
}

/** The first line at or after `from` that can carry a time (skips blank
 *  lines and section markers). `lines.length` when there is none. */
export function nextNonBlankIndex(lines: LyricsLine[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].instrumental) return i;
    if (lines[i].text === '') continue;
    if (isInstrumentalAnnotation(lines[i].text)) return i;
    if (isAdminAnnotation(lines[i].text)) continue;
    return i;
  }
  return lines.length;
}

function hasContent(lines: LyricsLine[]): boolean {
  return nextNonBlankIndex(lines, 0) < lines.length;
}

function push(stack: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const next = [...stack, snapshot];
  if (next.length > MAX_UNDO) next.shift();
  return next;
}

const snap = (s: LyricsEditorState): Snapshot => ({ lines: s.lines, currentSyncIndex: s.currentSyncIndex });

/** Fields every undoable edit sets alongside its own changes. */
const edited = (s: LyricsEditorState) => ({
  undoStack: push(s.undoStack, snap(s)),
  redoStack: [] as Snapshot[],
  dirty: true,
});

const initialState = {
  isOpen: false,
  mode: 'lyrics' as LyricsEditorMode,
  lines: [] as LyricsLine[],
  dirty: false,
  undoStack: [] as Snapshot[],
  redoStack: [] as Snapshot[],
  currentSyncIndex: 0,
  reviewIndex: null as number | null,
};

export const useLyricsEditorStore = create<LyricsEditorState>((set) => ({
  ...initialState,

  open: (lines) =>
    set({
      ...initialState,
      isOpen: true,
      // No words yet: start in the text box. Otherwise go straight to timing.
      mode: hasContent(lines) ? 'timing' : 'lyrics',
      lines,
      currentSyncIndex: nextNonBlankIndex(lines, 0),
    }),

  close: () => set({ ...initialState }),

  setMode: (mode) =>
    set((s) => {
      if (mode === s.mode) return s;
      if (mode === 'lyrics') {
        // One undo step covers the whole text editing session.
        return { mode, undoStack: push(s.undoStack, snap(s)), redoStack: [] };
      }
      // Back to timing: resume at the first line that still needs a time.
      const firstUntimed = s.lines.findIndex(
        (l, i) => l.time === null && nextNonBlankIndex(s.lines, i) === i,
      );
      return {
        mode,
        currentSyncIndex: firstUntimed >= 0 ? firstUntimed : s.lines.length,
        reviewIndex: null,
      };
    }),

  replaceLines: (lines) => set({ lines, dirty: true }),

  importLines: (lines) =>
    set((s) => ({
      ...edited(s),
      lines,
      currentSyncIndex: nextNonBlankIndex(lines, 0),
      reviewIndex: null,
    })),

  syncLine: (index, time) =>
    set((s) => {
      const lines = s.lines.map((l, i) => (i === index ? { ...l, time } : l));
      return {
        ...edited(s),
        lines,
        currentSyncIndex: nextNonBlankIndex(lines, index + 1),
        reviewIndex: index,
      };
    }),

  cueEnd: (time) =>
    set((s) => {
      // Trailing blank lines are just the end of the text box.
      let end = s.lines.length;
      while (end > 0 && s.lines[end - 1].text === '' && !s.lines[end - 1].instrumental) end--;
      const lines = [...s.lines.slice(0, end), { text: END_MARKER, time }];
      return {
        ...edited(s),
        lines,
        currentSyncIndex: lines.length,
        reviewIndex: lines.length - 1,
      };
    }),

  stepBack: () =>
    set((s) => {
      let prev = -1;
      for (let i = s.currentSyncIndex - 1; i >= 0; i--) {
        if (nextNonBlankIndex(s.lines, i) === i) { prev = i; break; }
      }
      if (prev < 0) return s;
      return {
        ...edited(s),
        lines: s.lines.map((l, i) => (i === prev ? { ...l, time: null } : l)),
        currentSyncIndex: prev,
        reviewIndex: prev,
      };
    }),

  moveLine: (index, time) =>
    set((s) => ({
      ...edited(s),
      lines: s.lines.map((l, i) => (i === index ? { ...l, time } : l)),
    })),

  nudgeLine: (index, delta) =>
    set((s) => {
      const line = s.lines[index];
      if (!line || line.time === null) return s;
      // Stay between the neighbouring timed lines so the order holds.
      let lo = 0;
      let hi = Number.POSITIVE_INFINITY;
      for (let i = index - 1; i >= 0; i--) {
        if (s.lines[i].time !== null) { lo = s.lines[i].time! + 0.01; break; }
      }
      for (let i = index + 1; i < s.lines.length; i++) {
        if (s.lines[i].time !== null) { hi = s.lines[i].time! - 0.01; break; }
      }
      const time = Math.round(Math.min(hi, Math.max(lo, line.time + delta)) * 1000) / 1000;
      if (time === line.time) return s;
      return {
        ...edited(s),
        lines: s.lines.map((l, i) => (i === index ? { ...l, time } : l)),
      };
    }),

  selectLine: (index) => set({ currentSyncIndex: index, reviewIndex: index }),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return s;
      const stack = [...s.undoStack];
      const prev = stack.pop()!;
      return {
        undoStack: stack,
        redoStack: push(s.redoStack, snap(s)),
        lines: prev.lines,
        currentSyncIndex: prev.currentSyncIndex,
        reviewIndex: null,
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return s;
      const stack = [...s.redoStack];
      const next = stack.pop()!;
      return {
        redoStack: stack,
        undoStack: push(s.undoStack, snap(s)),
        lines: next.lines,
        currentSyncIndex: next.currentSyncIndex,
        reviewIndex: null,
        dirty: true,
      };
    }),
}));
