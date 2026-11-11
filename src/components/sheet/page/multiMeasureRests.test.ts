import { describe, expect, it } from 'vitest';
import type { MeasureRect } from './museEncoreEngine';
import { splitMultiMeasureRests } from './multiMeasureRests';

const rect = (x: number, width: number): MeasureRect => ({ page: 0, x, y: 1, width, height: 2 });

describe('splitMultiMeasureRests', () => {
  it('leaves ordinary measures alone', () => {
    const rects = [rect(0, 2), rect(2, 2), null, rect(4, 2)];
    const beats = [0.5, 2, null, 4];
    expect(splitMultiMeasureRests(rects, beats)).toEqual({ rects, beats });
  });

  it('splits a multi-measure rest evenly from its first beat', () => {
    // Measure 0, then a 4-bar rest drawn as one box from 2 to 7 (beat at 3), then measure 5.
    const mm = rect(2, 5);
    const { rects, beats } = splitMultiMeasureRests(
      [rect(0, 2), mm, mm, mm, mm, rect(7, 2)],
      [0, 3, 3, 3, 3, 7],
    );
    expect(rects.map((r) => r && [r.x, r.width])).toEqual([[0, 2], [2, 2], [4, 1], [5, 1], [6, 1], [7, 2]]);
    expect(beats).toEqual([0, 3, 4, 5, 6, 7]);
    expect(rects[2]).toMatchObject({ page: 0, y: 1, height: 2 });
  });

  it('splits from the box start when there is no usable beat', () => {
    const mm = rect(0, 4);
    const { rects, beats } = splitMultiMeasureRests([mm, mm], [null, null]);
    expect(rects.map((r) => r && [r.x, r.width])).toEqual([[0, 2], [2, 2]]);
    expect(beats).toEqual([null, 2]);
  });
});
