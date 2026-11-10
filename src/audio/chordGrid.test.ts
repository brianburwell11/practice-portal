import { describe, expect, it } from 'vitest';
import {
  beatGrid, beatPositionAt, cellFor, isFreeTime, isOffGrid, lastAtOrBefore, pushTimeFor, snapTime, timeAtBeatPosition,
} from './chordGrid';
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
    expect(g.map((l) => l.label)).toEqual(['A', undefined, undefined, undefined]);
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

  it('counts a double tap once, keeping the bar line', () => {
    const tapMap: TapMapEntry[] = [
      { time: 9.095, type: 'measure' },
      { time: 9.101, type: 'beat' }, // 6 ms later: the same tap twice
      { time: 9.4, type: 'beat' },
      { time: 9.7, type: 'beat' },
      { time: 9.716, type: 'beat' },
      { time: 10, type: 'measure' },
    ];
    expect(times(beatGrid(tapMap, ts44))).toEqual([9.095, 9.4, 9.7, 10]);
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


// Beats every second from 10 to 18 (two bars of 4/4 plus a final bar line).
const grid = Array.from({ length: 9 }, (_, i) => ({ time: 10 + i, bar: i % 4 === 0 }));

describe('free time', () => {
  it('is everything when there is no grid', () => {
    expect(isFreeTime(5, [])).toBe(true);
  });
  it('is before the first tap and after the last', () => {
    expect(isFreeTime(9, grid)).toBe(true);
    expect(isFreeTime(9.9, grid)).toBe(false);
    expect(isFreeTime(14, grid)).toBe(false);
    expect(isFreeTime(18.1, grid)).toBe(false);
    expect(isFreeTime(19, grid)).toBe(true);
  });
});

describe('beat positions', () => {
  it('round-trips between seconds and beats', () => {
    expect(beatPositionAt(12.5, grid)).toBeCloseTo(2.5);
    expect(timeAtBeatPosition(2.5, grid)).toBeCloseTo(12.5);
  });
});

describe('snapTime', () => {
  it('snaps to the beat, half beat or quarter beat', () => {
    expect(snapTime(12.4, grid, 'beat')).toBe(12);
    expect(snapTime(12.4, grid, 'half')).toBe(12.5);
    expect(snapTime(12.2, grid, 'quarter')).toBe(12.25);
  });
  it('leaves stamps alone when off, or in free time', () => {
    expect(snapTime(12.4, grid, 'off')).toBe(12.4);
    expect(snapTime(5.37, grid, 'half')).toBe(5.37);
  });
});

describe('isOffGrid', () => {
  it('accepts beats and pushes, flags anything else', () => {
    expect(isOffGrid(12, grid)).toBe(false);
    expect(isOffGrid(12.5, grid)).toBe(false);
    expect(isOffGrid(12.05, grid)).toBe(false);
    expect(isOffGrid(12.3, grid)).toBe(true);
    expect(isOffGrid(5, grid)).toBe(false); // free time
  });
});

describe('pushes', () => {
  it('a push onto beat 4 sounds on the "and" of 3', () => {
    expect(pushTimeFor(4, grid)).toBe(13.5);
  });
  it('a chord on an "and" is written as a push on the next beat', () => {
    expect(cellFor(13.5, grid)).toEqual({ index: 4, push: true });
    expect(cellFor(14.02, grid)).toEqual({ index: 4, push: false });
    expect(cellFor(5, grid)).toBeNull();
  });
});
