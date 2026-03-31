import type { TapMapEntry } from './types';

/** Get only section entries from a tapMap. */
export function getSections(tapMap: TapMapEntry[]): TapMapEntry[] {
  return tapMap.filter(e => e.type === 'section');
}

/** Get measure-level entries (sections + measures) from a tapMap. */
export function getMeasureStarts(tapMap: TapMapEntry[]): TapMapEntry[] {
  return tapMap.filter(e => e.type === 'section' || e.type === 'measure');
}

/** Binary search for the nearest entry to a given time. Returns the index. */
export function findNearestEntry(tapMap: TapMapEntry[], time: number): number {
  if (tapMap.length === 0) return -1;

  let lo = 0;
  let hi = tapMap.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (tapMap[mid].time < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // lo is the first entry >= time. Check if lo-1 is closer.
  if (lo > 0 && Math.abs(tapMap[lo - 1].time - time) < Math.abs(tapMap[lo].time - time)) {
    return lo - 1;
  }
  return lo;
}

/** Get the next auto-label letter for a new section (A, B, C, ..., Z, AA, AB, ...). */
export function autoLabelSection(tapMap: TapMapEntry[]): string {
  const sections = getSections(tapMap);
  const index = sections.length;
  // Simple: A-Z, then AA, AB, etc.
  if (index < 26) {
    return String.fromCharCode(65 + index);
  }
  return String.fromCharCode(65 + Math.floor(index / 26) - 1) + String.fromCharCode(65 + (index % 26));
}

/** Sort tapMap entries by time. Returns a new sorted array. */
export function sortTapMap(entries: TapMapEntry[]): TapMapEntry[] {
  return [...entries].sort((a, b) => a.time - b.time);
}
