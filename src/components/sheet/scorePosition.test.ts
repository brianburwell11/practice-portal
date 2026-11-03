import { describe, expect, it } from 'vitest';
import { currentMeasureIndex } from '../../audio/tempoUtils';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { firstPlayedIndex, PAST_END, scorePositionAt, writtenOf } from './scorePosition';

const step = (srcIndex: number): UnfoldedStep => ({ srcIndex, pass: 1 });

describe('scorePositionAt', () => {
  const times = [1, 3, 5, 7]; // four measure downbeats, 2 s each

  it('needs at least two downbeats', () => {
    expect(scorePositionAt(2, [], [], 4)).toBeNull();
    expect(scorePositionAt(2, [1], [], 4)).toBeNull();
  });

  it('is in the first measure before its downbeat (count-in)', () => {
    expect(scorePositionAt(0, times, [], 4)).toEqual({ playedIndex: 0, writtenIndex: 0, fraction: 0, jumpsNext: false });
  });

  it('measures how far through the measure', () => {
    expect(scorePositionAt(4, times, [], 4)).toMatchObject({ playedIndex: 1, writtenIndex: 1, fraction: 0.5 });
  });

  it('gives the last measure a 1 s length past its downbeat', () => {
    expect(scorePositionAt(7.25, times, [], 4)).toMatchObject({ playedIndex: 3, fraction: 0.25 });
  });

  it('is past the end when the tapMap runs longer than the score', () => {
    expect(scorePositionAt(7.5, times, [], 3)).toBe(PAST_END);
  });

  it('maps played measures to written ones through the unfold, and flags jumps', () => {
    // Written 0 1 2, with 1-2 repeated: played 0 1 2 1 2.
    const unfolded = [0, 1, 2, 1, 2].map(step);
    const t = [0, 2, 4, 6, 8];
    expect(scorePositionAt(5, t, unfolded, 3)).toMatchObject({ playedIndex: 2, writtenIndex: 2, jumpsNext: true });
    expect(scorePositionAt(7, t, unfolded, 3)).toMatchObject({ playedIndex: 3, writtenIndex: 1, jumpsNext: false });
    // The last played measure doesn't jump anywhere.
    expect(scorePositionAt(9, t, unfolded, 3)).toMatchObject({ playedIndex: 4, writtenIndex: 2, jumpsNext: false });
  });
});

describe('writtenOf / firstPlayedIndex', () => {
  const unfolded = [0, 1, 2, 1, 2, 3].map(step);

  it('is the identity without repeats', () => {
    expect(writtenOf(5, [])).toBe(5);
    expect(firstPlayedIndex(5, [])).toBe(5);
  });

  it('maps through the unfold', () => {
    expect(writtenOf(3, unfolded)).toBe(1);
    expect(firstPlayedIndex(2, unfolded)).toBe(2);
    expect(firstPlayedIndex(3, unfolded)).toBe(5);
  });

  it('falls back to the index for a measure never played', () => {
    expect(firstPlayedIndex(9, unfolded)).toBe(9);
  });
});

/**
 * The strip's cursor math as it was before it moved into scorePosition.ts,
 * kept verbatim as a reference.
 */
function legacyCursor(position: number, audioOffset: number, measureXs: number[], measureTimes: number[], unfolded: UnfoldedStep[]) {
  const t = position - audioOffset;
  let mIdx = 0;
  let srcIdx = 0;
  let srcIdxNext = 0;
  let cursorContentX: number;
  const scoreMeasureCount = unfolded.length > 0 ? unfolded.length : Math.max(0, measureXs.length - 1);
  if (measureTimes.length >= 2) {
    mIdx = currentMeasureIndex(t + audioOffset, measureTimes);
    if (mIdx >= scoreMeasureCount) return { pastEnd: true as const };
    const s = unfolded.length > 0 ? unfolded[mIdx] : undefined;
    srcIdx = s?.srcIndex ?? mIdx;
    const nextStep = unfolded.length > 0 ? unfolded[mIdx + 1] : undefined;
    srcIdxNext = nextStep?.srcIndex ?? (mIdx + 1);
    const t0 = measureTimes[mIdx];
    const t1 = measureTimes[mIdx + 1] ?? t0 + 1;
    const frac = Math.max(0, Math.min(1, (t + audioOffset - t0) / Math.max(0.001, t1 - t0)));
    const x0 = measureXs[srcIdx] ?? 0;
    const isJump = srcIdxNext !== srcIdx + 1;
    const x1 = isJump ? (measureXs[srcIdx + 1] ?? x0) : (measureXs[srcIdxNext] ?? x0);
    cursorContentX = x0 + frac * (x1 - x0);
  } else {
    cursorContentX = measureXs[0] ?? 0;
  }
  return { pastEnd: false as const, mIdx, srcIdx, cursorContentX };
}

/** The same, through scorePositionAt, as ScrollingScore does it now. */
function currentCursor(position: number, measureXs: number[], measureTimes: number[], unfolded: UnfoldedStep[]) {
  const pos = scorePositionAt(position, measureTimes, unfolded, Math.max(0, measureXs.length - 1));
  if (pos === PAST_END) return { pastEnd: true as const };
  if (!pos) return { pastEnd: false as const, mIdx: 0, srcIdx: 0, cursorContentX: measureXs[0] ?? 0 };
  const x0 = measureXs[pos.writtenIndex] ?? 0;
  const x1 = measureXs[pos.writtenIndex + 1] ?? x0;
  return { pastEnd: false as const, mIdx: pos.playedIndex, srcIdx: pos.writtenIndex, cursorContentX: x0 + pos.fraction * (x1 - x0) };
}

describe('matches the strip cursor math it replaced', () => {
  // A small deterministic generator, so a failure is reproducible.
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  const rnd = (n: number) => Math.floor(rand() * n);

  it('on 20,000 random scores, tapMaps and positions', () => {
    for (let k = 0; k < 20000; k++) {
      const written = 1 + rnd(20);
      const xs: number[] = [];
      let x = 180;
      for (let i = 0; i <= written; i++) { xs.push(x); x += 40 + rnd(200); }
      if (rnd(10) === 0) xs.splice(rnd(xs.length), 1); // a missing barline
      const unfolded: UnfoldedStep[] = [];
      if (rnd(3) > 0) {
        const n = written + rnd(written * 2);
        for (let i = 0; i < n; i++) unfolded.push(step(rnd(4) === 0 ? rnd(written) : Math.min(written - 1, i % written)));
      }
      const played = (unfolded.length || written) + rnd(5) - 2; // tapMap shorter or longer than the score
      const times: number[] = [];
      let t = rnd(3);
      for (let i = 0; i < Math.max(0, played); i++) { times.push(t); t += 0.5 + rand() * 3; }
      const position = -2 + rand() * (t + 4);
      const a = legacyCursor(position, rand() * 3, xs, times, unfolded);
      const b = currentCursor(position, xs, times, unfolded);
      expect(b.pastEnd).toBe(a.pastEnd);
      if (!a.pastEnd && !b.pastEnd) {
        expect(b.mIdx).toBe(a.mIdx);
        expect(b.srcIdx).toBe(a.srcIdx);
        expect(b.cursorContentX).toBeCloseTo(a.cursorContentX, 9);
      }
    }
  });
});
