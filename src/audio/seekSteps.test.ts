import { describe, expect, it } from 'vitest';
import { barStarts, sectionStarts, stepTarget } from './seekSteps';
import type { TapMapEntry } from './types';

const map = [
  { time: 1, type: 'section', label: 'Intro' },
  { time: 1.5, type: 'beat' },
  { time: 3, type: 'measure' },
  { time: 5, type: 'section', label: 'Verse' },
  { time: 7, type: 'measure' },
] as TapMapEntry[];

describe('seek steps', () => {
  it('lists bar and section starts', () => {
    expect(barStarts(map)).toEqual([1, 3, 5, 7]);
    expect(sectionStarts(map)).toEqual([1, 5]);
    expect(barStarts(undefined)).toEqual([]);
  });

  it('steps ahead to the next start, or nowhere after the last', () => {
    expect(stepTarget([1, 3, 5, 7], 3.5, 1)).toBe(5);
    expect(stepTarget([1, 3, 5, 7], 3, 1)).toBe(5);
    expect(stepTarget([1, 3, 5, 7], 8, 1)).toBeNull();
  });

  it('steps back to the current start, then the one before', () => {
    expect(stepTarget([1, 3, 5, 7], 4.5, -1)).toBe(3);
    expect(stepTarget([1, 3, 5, 7], 3.2, -1)).toBe(1);
    expect(stepTarget([1, 3, 5, 7], 0.5, -1)).toBe(0);
  });
});
