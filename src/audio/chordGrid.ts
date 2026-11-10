import type { TapMapEntry, TimeSignatureEntry } from './types';

export interface GridLine {
  time: number;
  /** First beat of a measure. */
  bar: boolean;
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
    out.push({ time: start.time, bar: true });
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
