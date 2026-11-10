import { describe, expect, it } from 'vitest';
import { beatGrid, lastAtOrBefore } from './chordGrid';
import type { TapMapEntry } from './types';

const ts44 = [{ beat: 0, numerator: 4, denominator: 4 }];
const times = (g: { time: number }[]) => g.map((l) => +l.time.toFixed(3));

describe('beatGrid', () => {
  it('is empty without a tapMap (free time everywhere)', () => {
    expect(beatGrid(undefined, ts44)).toEqual([]);
    expect(beatGrid([], ts44)).toEqual([]);
  });

  it('uses tapped beats where they exist', () => {
    const tapMap: TapMapEntry[] = [
      { time: 1, type: 'section', label: 'A' },
      { time: 1.4, type: 'beat' },
      { time: 2.1, type: 'beat' },
      { time: 3, type: 'measure' },
    ];
    const g = beatGrid(tapMap, ts44);
    expect(times(g)).toEqual([1, 1.4, 2.1, 3]);
    expect(g.map((l) => l.bar)).toEqual([true, false, false, true]);
  });

  it('fills in beats evenly from the time signature when only measures are tapped', () => {
    const tapMap: TapMapEntry[] = [
      { time: 0, type: 'measure' },
      { time: 2, type: 'measure' },
      { time: 4, type: 'measure' },
    ];
    expect(times(beatGrid(tapMap, ts44))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
  });

  it('follows a time signature change, counted in beats', () => {
    const tapMap: TapMapEntry[] = [
      { time: 0, type: 'measure' },
      { time: 4, type: 'measure' },
      { time: 7, type: 'measure' },
      { time: 10, type: 'measure' },
    ];
    // 4/4 for the first bar (beats 0-3), then 3/4 from beat 4.
    const map = [
      { beat: 0, numerator: 4, denominator: 4 },
      { beat: 4, numerator: 3, denominator: 4 },
    ];
    expect(times(beatGrid(tapMap, map))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('adds no inner beats after the last tap', () => {
    const tapMap: TapMapEntry[] = [{ time: 5, type: 'measure' }];
    expect(times(beatGrid(tapMap, ts44))).toEqual([5]);
  });

  it('sorts taps that arrive out of order', () => {
    const tapMap: TapMapEntry[] = [
      { time: 2, type: 'measure' },
      { time: 0, type: 'measure' },
    ];
    expect(times(beatGrid(tapMap, [{ beat: 0, numerator: 2, denominator: 4 }]))).toEqual([0, 1, 2]);
  });
});

describe('lastAtOrBefore', () => {
  const items = [{ time: 1 }, { time: 2 }, { time: 4 }];
  it('finds the item sounding at a time', () => {
    expect(lastAtOrBefore(items, 0.5)).toBe(-1);
    expect(lastAtOrBefore(items, 1)).toBe(0);
    expect(lastAtOrBefore(items, 3.9)).toBe(1);
    expect(lastAtOrBefore(items, 99)).toBe(2);
  });
});
