import { create } from 'zustand';
import type { ChordEvent } from '../audio/chordsTypes';
import { isOffGrid, round3, snapTime, type GridLine, type Snap } from '../audio/chordGrid';
import type { Clip } from '../components/chords-editor/gridRange';

const MAX_UNDO = 50;
/** Two chords this close (seconds) are the same spot. */
const SAME_SPOT = 0.01;
/** Chords never get closer than this to each other when nudged. */
const MIN_GAP = 0.01;

export type ChordsEditorMode = 'grid' | 'stamp';

/** A chord waiting to be stamped. `section` marks the first chord of a
 *  section from an imported sheet, shown as a divider in the queue. */
export interface QueueItem {
  symbol: string;
  section?: string;
}

/** A stamp made this session: where, and the queue item it used up. */
interface Stamped {
  time: number;
  item: QueueItem;
}

/** An undo step: the chords plus the stamp queue, so undoing a stamp puts
 *  its chord back in line. */
interface Snapshot {
  chords: ChordEvent[];
  queue: QueueItem[];
  stamped: Stamped[];
}

const SNAP_KEY = 'practice-portal.chordSnap';
const SNAPS: Snap[] = ['off', 'beat', 'half', 'quarter'];

function loadSnap(): Snap {
  try {
    const v = window.localStorage.getItem(SNAP_KEY) as Snap | null;
    return v && SNAPS.includes(v) ? v : 'half';
  } catch {
    return 'half';
  }
}

interface ChordsEditorState {
  isOpen: boolean;
  /** Grid = type chords on the beat grid. Stamp = tap chords in at the playhead. */
  mode: ChordsEditorMode;
  /** The draft, sorted by time. */
  chords: ChordEvent[];
  dirty: boolean;
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  /** Chords waiting to be stamped, next first. Already normalized. */
  queue: QueueItem[];
  /** Stamps made this session, oldest first, for Shift+Tab take-back. */
  stamped: Stamped[];
  /** The chord nudge, replay and delete act on (its time). */
  selected: number | null;
  /** How stamps snap. Remembered per person (this device). */
  snap: Snap;
  /** The last copied grid range. Kept across open/close (and songs) for the
   *  session; not part of undo. */
  clipboard: Clip | null;

  open: (chords: ChordEvent[]) => void;
  close: () => void;
  setMode: (mode: ChordsEditorMode) => void;
  /** Remove the chords at `remove` times, add `add`, as one undo step. */
  applyEdit: (remove: number[], add: ChordEvent[], select?: number | null) => void;
  setQueue: (queue: QueueItem[]) => void;
  /** Place the next queued chord at `time`. Returns false if the queue is empty. */
  stamp: (time: number) => boolean;
  /** Undo the last stamp: its chord comes off the lane and back to the queue's front. */
  takeBack: () => void;
  /** Move a chord by `delta` seconds, staying between its neighbours. */
  nudge: (time: number, delta: number) => void;
  select: (time: number | null) => void;
  /** Move every chord that a tapMap edit left off the grid to the nearest half beat. */
  snapOffGrid: (grid: GridLine[]) => number;
  setSnap: (snap: Snap) => void;
  setClipboard: (clip: Clip | null) => void;
  undo: () => void;
  redo: () => void;
}

function sortChords(chords: ChordEvent[]): ChordEvent[] {
  return [...chords].sort((a, b) => a.time - b.time);
}

const sameSpot = (a: number, b: number) => Math.abs(a - b) < SAME_SPOT;

function push(stack: Snapshot[], s: Snapshot): Snapshot[] {
  const next = [...stack, s];
  if (next.length > MAX_UNDO) next.shift();
  return next;
}

const snap = (s: ChordsEditorState): Snapshot => ({ chords: s.chords, queue: s.queue, stamped: s.stamped });

/** Fields every undoable edit sets alongside its own changes. */
const edited = (s: ChordsEditorState) => ({
  undoStack: push(s.undoStack, snap(s)),
  redoStack: [] as Snapshot[],
  dirty: true,
});

const initialState = {
  isOpen: false,
  mode: 'grid' as ChordsEditorMode,
  chords: [] as ChordEvent[],
  dirty: false,
  undoStack: [] as Snapshot[],
  redoStack: [] as Snapshot[],
  queue: [] as QueueItem[],
  stamped: [] as Stamped[],
  selected: null as number | null,
};

export const useChordsEditorStore = create<ChordsEditorState>((set, get) => ({
  ...initialState,
  snap: typeof window === 'undefined' ? 'half' : loadSnap(),
  clipboard: null,

  open: (chords) => set({ ...initialState, isOpen: true, chords: sortChords(chords) }),

  close: () => set({ ...initialState }),

  setMode: (mode) => set({ mode }),

  applyEdit: (remove, add, select) =>
    set((s) => {
      const gone = (c: ChordEvent) => remove.some((t) => sameSpot(t, c.time)) || add.some((a) => sameSpot(a.time, c.time));
      const added = add.map((c) => ({ symbol: c.symbol, time: round3(c.time) }));
      return {
        ...edited(s),
        chords: sortChords([...s.chords.filter((c) => !gone(c)), ...added]),
        ...(select !== undefined ? { selected: select } : {}),
      };
    }),

  setQueue: (queue) => set({ queue }),

  stamp: (time) => {
    const s = get();
    if (s.queue.length === 0) return false;
    const t = round3(time);
    const [item, ...rest] = s.queue;
    set({
      ...edited(s),
      chords: sortChords([...s.chords.filter((c) => !sameSpot(c.time, t)), { symbol: item.symbol, time: t }]),
      queue: rest,
      stamped: [...s.stamped, { time: t, item }],
      selected: t,
    });
    return true;
  },

  takeBack: () =>
    set((s) => {
      const last = s.stamped[s.stamped.length - 1];
      if (last === undefined) return s;
      const chord = s.chords.find((c) => sameSpot(c.time, last.time));
      return {
        ...edited(s),
        chords: s.chords.filter((c) => c !== chord),
        // Back to the front with its section divider, if it had one.
        queue: [last.item, ...s.queue],
        stamped: s.stamped.slice(0, -1),
        selected: null,
      };
    }),

  nudge: (time, delta) =>
    set((s) => {
      const i = s.chords.findIndex((c) => sameSpot(c.time, time));
      if (i < 0) return s;
      const lo = i > 0 ? s.chords[i - 1].time + MIN_GAP : 0;
      const hi = i < s.chords.length - 1 ? s.chords[i + 1].time - MIN_GAP : Number.POSITIVE_INFINITY;
      const t = round3(Math.min(hi, Math.max(lo, s.chords[i].time + delta)));
      if (t === s.chords[i].time) return s;
      return {
        ...edited(s),
        chords: s.chords.map((c, j) => (j === i ? { ...c, time: t } : c)),
        stamped: s.stamped.map((x) => (sameSpot(x.time, time) ? { ...x, time: t } : x)),
        selected: t,
      };
    }),

  select: (selected) => set({ selected }),

  snapOffGrid: (grid) => {
    const s = get();
    let moved = 0;
    const chords = s.chords.map((c) => {
      if (!isOffGrid(c.time, grid)) return c;
      moved++;
      return { ...c, time: snapTime(c.time, grid, 'half') };
    });
    if (moved === 0) return 0;
    // Two chords snapping onto the same half beat: keep the later one.
    const deduped = sortChords(chords).filter((c, i, all) => !(all[i + 1] && sameSpot(all[i + 1].time, c.time)));
    set({ ...edited(s), chords: deduped, selected: null });
    return moved;
  },

  setSnap: (value) => {
    try {
      window.localStorage.setItem(SNAP_KEY, value);
    } catch { /* private mode */ }
    set({ snap: value });
  },

  setClipboard: (clipboard) => set({ clipboard }),

  undo: () =>
    set((s) => {
      const prev = s.undoStack[s.undoStack.length - 1];
      if (!prev) return s;
      return {
        undoStack: s.undoStack.slice(0, -1),
        redoStack: push(s.redoStack, snap(s)),
        ...prev,
        selected: null,
        dirty: true,
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.redoStack[s.redoStack.length - 1];
      if (!next) return s;
      return {
        redoStack: s.redoStack.slice(0, -1),
        undoStack: push(s.undoStack, snap(s)),
        ...next,
        selected: null,
        dirty: true,
      };
    }),
}));
