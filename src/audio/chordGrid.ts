import type { TapMapEntry, TimeSignatureEntry } from './types';

export interface GridLine {
  time: number;
  /** First beat of a measure. */
  bar: boolean;
  /** The section's name, on the first beat of a section ("Verse", "A"). */
  label?: string;
}

/**
 * Every beat of a tapMap song, for drawing beat and bar lines.
 *
 * Measures (and sections, which start a measure) come from their taps. Inside
 * a measure, tapped beats are used as they are. A measure with no beat taps
 * is split evenly by its time signature's numerator. `timeSignatureMap` is
 * keyed by beat count from the first measure, so the beats are counted as
 * we go. The last measure has no next tap to measure against, so it gets no
 * inner beats: past the last tap is free time.
 *
 * Two taps within 60 ms are a double tap and count once.
 *
 * No tapMap, no grid: before the first tap and after the last is free time.
 */
export function beatGrid(tapMap: TapMapEntry[] | undefined, timeSignatureMap: TimeSignatureEntry[] = []): GridLine[] {
  if (!tapMap || tapMap.length === 0) return [];
  const sorted = [...tapMap].sort((a, b) => a.time - b.time);
  const starts = sorted.filter((e) => e.type !== 'beat');
  const out: GridLine[] = [];
  let beatCount = 0;

  starts.forEach((start, i) => {
    const end = starts[i + 1];
    out.push(start.type === 'section' && start.label ? { time: start.time, bar: true, label: start.label } : { time: start.time, bar: true });
    beatCount++;
    if (!end) return;
    const tapped = sorted.filter((e) => e.type === 'beat' && e.time > start.time && e.time < end.time);
    if (tapped.length > 0) {
      for (const b of tapped) out.push({ time: b.time, bar: false });
      beatCount += tapped.length;
      return;
    }
    const n = numeratorAt(timeSignatureMap, beatCount - 1);
    for (let k = 1; k < n; k++) out.push({ time: start.time + ((end.time - start.time) * k) / n, bar: false });
    beatCount += n - 1;
  });
  return dropDoubleTaps(out);
}

/** Taps closer than this are one tap entered twice, not two beats. */
const DOUBLE_TAP_SECONDS = 0.06;

/** Drop the second of any two lines a double tap apart, keeping a bar line
 *  (and its section label) over a beat. Real tapMaps have a few of these. */
function dropDoubleTaps(lines: GridLine[]): GridLine[] {
  const out: GridLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && line.time - prev.time < DOUBLE_TAP_SECONDS) {
      if ((line.bar && !prev.bar) || (line.bar && prev.bar && line.label && !prev.label)) out[out.length - 1] = line;
      continue;
    }
    out.push(line);
  }
  return out;
}

function numeratorAt(map: TimeSignatureEntry[], beat: number): number {
  let n = map[0]?.numerator ?? 4;
  for (const e of map) {
    if (e.beat <= beat) n = e.numerator;
    else break;
  }
  return Math.max(1, Math.round(n));
}

/** Index of the last item at or before `t`, or -1. Items sorted by time. */
export function lastAtOrBefore<T extends { time: number }>(items: T[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Snap resolutions, in divisions per beat. Off never moves anything. */
export type Snap = 'off' | 'beat' | 'half' | 'quarter';
const DIVISIONS: Record<Snap, number> = { off: 0, beat: 1, half: 2, quarter: 4 };

function beatLength(grid: GridLine[], i: number): number {
  if (grid.length < 2) return 0.5;
  if (i >= grid.length - 1) return grid[grid.length - 1].time - grid[grid.length - 2].time;
  return grid[i + 1].time - grid[i].time;
}

/** True where there's no beat grid to place a chord on: no tapMap at all,
 *  before the first tap, or past the last one. */
export function isFreeTime(t: number, grid: GridLine[]): boolean {
  if (grid.length < 2) return true;
  const last = grid.length - 1;
  return t < grid[0].time - beatLength(grid, 0) / 4 || t > grid[last].time + beatLength(grid, last) / 4;
}

/** Fractional beat index of `t` (2.5 = halfway between beats 2 and 3). */
export function beatPositionAt(t: number, grid: GridLine[]): number {
  if (grid.length === 0) return 0;
  const i = Math.max(0, Math.min(grid.length - 2, lastAtOrBefore(grid, t)));
  if (grid.length === 1) return 0;
  return i + (t - grid[i].time) / (grid[i + 1].time - grid[i].time);
}

/** Seconds at a fractional beat index, interpolating between beats. */
export function timeAtBeatPosition(p: number, grid: GridLine[]): number {
  if (grid.length === 0) return 0;
  if (grid.length === 1) return grid[0].time;
  const i = Math.max(0, Math.min(grid.length - 2, Math.floor(p)));
  return grid[i].time + (p - i) * (grid[i + 1].time - grid[i].time);
}

/** `t` moved to the nearest line at this resolution. Free time stays put. */
export function snapTime(t: number, grid: GridLine[], snap: Snap): number {
  const div = DIVISIONS[snap];
  if (!div || isFreeTime(t, grid)) return t;
  const p = Math.round(beatPositionAt(t, grid) * div) / div;
  return round3(timeAtBeatPosition(Math.max(0, Math.min(grid.length - 1, p)), grid));
}

/**
 * Whether a chord sits away from every half beat by more than `tolerance`
 * of a beat: what a tapMap edit leaves behind. Free time is never off grid.
 */
export function isOffGrid(t: number, grid: GridLine[], tolerance = 0.125): boolean {
  if (isFreeTime(t, grid)) return false;
  const p = beatPositionAt(t, grid) * 2;
  return Math.abs(p - Math.round(p)) / 2 > tolerance;
}

/** The time of the "and" before beat `i`: where a chord pushed onto beat `i` sounds. */
export function pushTimeFor(i: number, grid: GridLine[]): number {
  if (i <= 0) return round3(grid[0].time - beatLength(grid, 0) / 2);
  return round3((grid[i - 1].time + grid[i].time) / 2);
}

/**
 * Which grid cell (beat) a chord is written in, chart style: a chord on the
 * "and" before a beat is a push, written on that beat. Null in free time.
 */
export function cellFor(t: number, grid: GridLine[]): { index: number; push: boolean } | null {
  if (isFreeTime(t, grid)) return null;
  const p = beatPositionAt(t, grid);
  const frac = p - Math.floor(p);
  if (frac > 0.375 && frac < 0.625) return { index: Math.min(grid.length - 1, Math.floor(p) + 1), push: true };
  return { index: Math.max(0, Math.min(grid.length - 1, Math.round(p))), push: false };
}

export function round3(t: number): number {
  return Math.round(t * 1000) / 1000;
}
