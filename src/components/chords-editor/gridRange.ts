import { cellFor, pushTimeFor, type GridLine } from '../../audio/chordGrid';
import type { ChordEvent } from '../../audio/chordsTypes';

/** A copied stretch of the grid: how many beats it spans, and the chords in it
 *  by beat offset. Empty beats are part of it, so pasting clears them. */
export interface Clip {
  length: number;
  items: { offset: number; symbol: string; push: boolean }[];
}

const inRange = (i: number, from: number, to: number) => i >= Math.min(from, to) && i <= Math.max(from, to);

/** Times of the chords written in cells `from`..`to` (pushes count in the
 *  cell they're written in). Free-time chords are never in a range. */
export function chordsInRange(chords: ChordEvent[], grid: GridLine[], from: number, to: number): number[] {
  return chords.filter((c) => {
    const cell = cellFor(c.time, grid);
    return !!cell && inRange(cell.index, from, to);
  }).map((c) => c.time);
}

export function copyRange(chords: ChordEvent[], grid: GridLine[], from: number, to: number): Clip {
  const start = Math.min(from, to);
  const items: Clip['items'] = [];
  for (const c of chords) {
    const cell = cellFor(c.time, grid);
    if (cell && inRange(cell.index, from, to)) items.push({ offset: cell.index - start, symbol: c.symbol, push: cell.push });
  }
  return { length: Math.abs(to - from) + 1, items };
}

/**
 * What pasting `clip` at cell `at` does: everything in the span it covers is
 * replaced, beat for beat. The span stops at the end of the grid.
 */
export function pasteEdit(
  chords: ChordEvent[],
  grid: GridLine[],
  clip: Clip,
  at: number,
): { remove: number[]; add: ChordEvent[]; end: number } {
  const end = Math.min(grid.length - 1, at + clip.length - 1);
  const remove = chordsInRange(chords, grid, at, end);
  const add = clip.items
    .filter((it) => at + it.offset <= end)
    .map((it) => ({ symbol: it.symbol, time: it.push ? pushTimeFor(at + it.offset, grid) : grid[at + it.offset].time }));
  return { remove, add, end };
}
