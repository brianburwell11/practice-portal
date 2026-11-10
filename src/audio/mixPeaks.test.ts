import { describe, it, expect } from 'vitest';
import { computeStemEnvelope, mixEnvelopes, maxOf } from './mixPeaks';

function fakeBuffer(channels: number[][], sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    length: channels[0].length,
    numberOfChannels: channels.length,
    duration: channels[0].length / sampleRate,
    getChannelData: (ch: number) => Float32Array.from(channels[ch]),
  } as unknown as AudioBuffer;
}

const env = (...v: number[]) => Float32Array.from(v);

describe('computeStemEnvelope', () => {
  it('takes the peak of the mono downmix per bucket', () => {
    // 4 samples/sec, 2 buckets/sec → 2 samples per bucket
    const buf = fakeBuffer([[0.2, -0.6, 0, 1], [0.2, -0.2, 0, -1]], 4);
    const out = computeStemEnvelope(buf, 2);
    expect(Array.from(out)).toEqual([expect.closeTo(0.4), 0]);
  });

  it('downmixes more than two channels', () => {
    const buf = fakeBuffer([[0.3, 0], [0.3, 0], [-0.3, 0.9]], 2);
    expect(Array.from(computeStemEnvelope(buf, 1))).toEqual([expect.closeTo(0.3)]);
  });

  it('measures negative peaks too', () => {
    const buf = fakeBuffer([[-0.8, 0.2]], 2);
    expect(computeStemEnvelope(buf, 1)[0]).toBeCloseTo(0.8);
  });

  it('covers a partial last bucket', () => {
    const buf = fakeBuffer([[0.1, 0.1, 0.5]], 4);
    expect(computeStemEnvelope(buf, 2).length).toBe(2);
  });
});

describe('mixEnvelopes', () => {
  it('returns gain * env for a single stem', () => {
    const out = mixEnvelopes([{ env: env(0.5, 1), offsetSec: 0, gain: 0.5 }], 2, 1);
    expect(Array.from(out)).toEqual([0.25, 0.5]);
  });

  it('sizes the output to the duration', () => {
    expect(mixEnvelopes([], 2.5, 10).length).toBe(25);
  });

  it('shifts later for a positive offset', () => {
    const out = mixEnvelopes([{ env: env(1, 1), offsetSec: 1, gain: 1 }], 4, 1);
    expect(Array.from(out)).toEqual([0, 1, 1, 0]);
  });

  it('skips the start for a negative offset', () => {
    const out = mixEnvelopes([{ env: env(0.1, 0.2, 0.3), offsetSec: -1, gain: 1 }], 3, 1);
    expect(Array.from(out).map((v) => +v.toFixed(3))).toEqual([0.2, 0.3, 0]);
  });

  it('leaves out muted stems', () => {
    const out = mixEnvelopes(
      [
        { env: env(1, 1), offsetSec: 0, gain: 0 },
        { env: env(0.5, 0.5), offsetSec: 0, gain: 1 },
      ],
      2,
      1,
    );
    expect(Array.from(out)).toEqual([0.5, 0.5]);
  });

  it('combines stems as root-sum-square', () => {
    const out = mixEnvelopes(
      [
        { env: env(0.3), offsetSec: 0, gain: 1 },
        { env: env(0.4), offsetSec: 0, gain: 1 },
      ],
      1,
      1,
    );
    expect(out[0]).toBeCloseTo(0.5);
  });
});

describe('maxOf', () => {
  it('finds the largest value', () => {
    expect(maxOf(env(0.1, 0.7, 0.3))).toBeCloseTo(0.7);
    expect(maxOf(env())).toBe(0);
  });
});
