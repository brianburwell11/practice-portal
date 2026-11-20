import { describe, expect, it } from 'vitest';
import { measureBeatAt, measureBeatToTime } from './tempoUtils';
import type { TapMapEntry } from './types';

// Two 4/4 bars then a 3/4 bar, one beat per second.
const tapMap: TapMapEntry[] = [
  { time: 0, type: 'section', label: 'Intro' }, { time: 1, type: 'beat' }, { time: 2, type: 'beat' }, { time: 3, type: 'beat' },
  { time: 4, type: 'measure' }, { time: 5, type: 'beat' }, { time: 6, type: 'beat' }, { time: 7, type: 'beat' },
  { time: 8, type: 'section', label: 'Verse' }, { time: 9, type: 'beat' }, { time: 10, type: 'beat' },
];

describe('measureBeatToTime', () => {
  it('finds a measure and beat', () => {
    expect(measureBeatToTime(tapMap, 1, 1)).toBe(0);
    expect(measureBeatToTime(tapMap, 2, 3)).toBe(6);
    expect(measureBeatToTime(tapMap, 3, 3)).toBe(10);
  });
  it('falls back to the start of the measure for a beat it lacks', () => {
    expect(measureBeatToTime(tapMap, 3, 4)).toBe(8);
  });
  it('is null past the last measure or without a tapMap', () => {
    expect(measureBeatToTime(tapMap, 4, 1)).toBeNull();
    expect(measureBeatToTime(undefined, 1, 1)).toBeNull();
  });
  it('round-trips with measureBeatAt', () => {
    for (const e of tapMap) {
      const mb = measureBeatAt(tapMap, e.time)!;
      expect(measureBeatToTime(tapMap, mb.measure, mb.beat)).toBe(e.time);
    }
  });
});
