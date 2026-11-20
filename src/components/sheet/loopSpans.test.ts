import { describe, expect, it } from 'vitest';
import type { TapMapEntry } from '../../audio/types';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { loopSpans, measureBeatTimes, spanEdges, type LoopSpan } from './loopSpans';

const step = (srcIndex: number): UnfoldedStep => ({ srcIndex, pass: 1 });

/** `count` measures of 4 beats, 1 s per beat, starting at 0. */
function fourFour(count: number): number[][] {
  return Array.from({ length: count }, (_, m) => [0, 1, 2, 3].map((b) => m * 4 + b));
}

describe('measureBeatTimes', () => {
  it('groups beat taps under their measure, ignoring beats before the first', () => {
    const tapMap: TapMapEntry[] = [
      { time: 0.5, type: 'beat' },
      { time: 1, type: 'section', label: 'Intro' },
      { time: 2, type: 'beat' },
      { time: 3, type: 'measure' },
      { time: 4, type: 'beat' },
    ];
    expect(measureBeatTimes(tapMap)).toEqual([[1, 2], [3, 4]]);
  });
});

describe('loopSpans', () => {
  const beats = fourFour(4);

  it('is empty without both ends', () => {
    expect(loopSpans(null, 5, beats, [], 4)).toEqual([]);
    expect(loopSpans(5, null, beats, [], 4)).toEqual([]);
  });

  it('covers whole measures for a loop on barlines', () => {
    expect(loopSpans(4, 12, beats, [], 4)).toEqual([
      { written: 1, from: 0, to: 4, beats: 4, isStart: true, isEnd: false },
      { written: 2, from: 0, to: 4, beats: 4, isStart: false, isEnd: true },
    ]);
  });

  it('starts and ends on beats', () => {
    // Beat 3 of measure 1 to beat 2 of measure 2.
    expect(loopSpans(2, 5, beats, [], 4)).toEqual([
      { written: 0, from: 2, to: 4, beats: 4, isStart: true, isEnd: false },
      { written: 1, from: 0, to: 1, beats: 4, isStart: false, isEnd: true },
    ]);
  });

  it('goes between beats for an unsnapped end', () => {
    expect(loopSpans(1.5, 2.25, beats, [], 4)).toEqual([
      { written: 0, from: 1.5, to: 2.25, beats: 4, isStart: true, isEnd: true },
    ]);
  });

  it('stops at the last measure of the score', () => {
    const spans = loopSpans(12, 99, beats, [], 4);
    expect(spans).toEqual([{ written: 3, from: 0, to: 4, beats: 4, isStart: true, isEnd: true }]);
  });

  it('maps played measures through the unfold, one span per written measure', () => {
    // Written 0 1 2, with 1 repeated: played 0 1 1 2.
    const unfolded = [0, 1, 1, 2].map(step);
    expect(loopSpans(4, 14, fourFour(4), unfolded, 3)).toEqual([
      { written: 1, from: 0, to: 4, beats: 4, isStart: true, isEnd: false },
      { written: 2, from: 0, to: 2, beats: 4, isStart: false, isEnd: true },
    ]);
    // Ending in the second time through: the written measure gets both ends.
    expect(loopSpans(5, 10, fourFour(4), unfolded, 3)).toEqual([
      { written: 1, from: 0, to: 4, beats: 4, isStart: true, isEnd: true },
    ]);
  });
});

describe('spanEdges', () => {
  const span = (from: number, to: number): LoopSpan => ({ written: 0, from, to, beats: 4, isStart: true, isEnd: true });

  it('runs barline to barline for a whole measure', () => {
    expect(spanEdges(span(0, 4), 100, 104, 300, null)).toEqual({ x0: 100, x1: 300 });
  });

  it('starts just before the first note past a system header', () => {
    expect(spanEdges(span(0, 4), 100, 160, 300, null).x0).toBe(156);
  });

  it('uses where MuseScore puts the beats', () => {
    const xs = [104, 130, 220, 260];
    expect(spanEdges(span(1, 3), 100, 104, 300, xs)).toEqual({ x0: 126, x1: 256 });
  });

  it('spaces beats evenly when MuseScore has none', () => {
    expect(spanEdges(span(2, 4), 100, 100, 300, [100, null, null, null])).toEqual({ x0: 196, x1: 300 });
  });
});
