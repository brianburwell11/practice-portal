import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_PERIOD, EARLY_LIMIT_MS, MIN_TAPS, WARMUP_TAPS, summarize, tapOffsetMs,
} from './latencyCalibration';

const P = CALIBRATION_PERIOD;

describe('tapOffsetMs', () => {
  it('measures a late tap against its own click', () => {
    expect(tapOffsetMs(10 + 3 * P + 0.22, 10)).toBeCloseTo(220, 6);
  });

  it('measures an early tap against the coming click', () => {
    expect(tapOffsetMs(10 + 3 * P - 0.03, 10)).toBeCloseTo(-30, 6);
  });

  it('reads long delays as late, up to the early limit before the next click', () => {
    const late = P * 1000 - EARLY_LIMIT_MS - 1;
    expect(tapOffsetMs(10 + 2 * P + late / 1000, 10)).toBeCloseTo(late, 6);
    expect(tapOffsetMs(10 + 3 * P - EARLY_LIMIT_MS / 1000, 10)).toBeCloseTo(-EARLY_LIMIT_MS, 6);
  });

  it('handles taps before the first click', () => {
    expect(tapOffsetMs(10 - 0.05, 10)).toBeCloseTo(-50, 6);
  });
});

describe('summarize', () => {
  it('ignores warm-up taps', () => {
    const s = summarize([500, 500, 500, 500]);
    expect(s).toEqual({ estimateMs: null, sdMs: null, count: 0, stable: false });
    expect(summarize([0, 0, 0, 0, 200]).estimateMs).toBe(200);
  });

  it('converges on a steady tapper and goes stable', () => {
    const offsets = Array.from({ length: WARMUP_TAPS + MIN_TAPS }, (_, i) => 220 + ((i * 7) % 11) - 5);
    const s = summarize(offsets);
    expect(s.estimateMs).toBeGreaterThanOrEqual(215);
    expect(s.estimateMs).toBeLessThanOrEqual(225);
    expect(s.stable).toBe(true);
  });

  it('needs enough taps before it can go stable', () => {
    const s = summarize(Array(WARMUP_TAPS + MIN_TAPS - 1).fill(200));
    expect(s.stable).toBe(false);
  });

  it('drops a stray tap from the estimate', () => {
    const offsets = [...Array(WARMUP_TAPS + MIN_TAPS - 1).fill(200), 330];
    const s = summarize(offsets);
    expect(s.estimateMs).toBe(200);
    expect(s.stable).toBe(true);
  });

  it('never goes stable on scattered taps', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const offsets = Array.from({ length: 60 }, () => rand() * 300);
    expect(summarize(offsets).stable).toBe(false);
  });
});
