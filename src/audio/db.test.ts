import { describe, expect, it } from 'vitest';
import { formatDb, parseDb } from './db';

describe('formatDb', () => {
  it('shows silence as -∞', () => {
    expect(formatDb(0)).toBe('-∞');
  });

  it('shows unity gain as 0.0', () => {
    expect(formatDb(1)).toBe('0.0');
    expect(formatDb(0.9999)).toBe('0.0');
  });

  it('signs boosts and cuts to one decimal', () => {
    expect(formatDb(1.5)).toBe('+3.5');
    expect(formatDb(0.5)).toBe('-6.0');
    expect(formatDb(0.01)).toBe('-40.0');
  });
});

describe('parseDb', () => {
  it('turns dB into gain', () => {
    expect(parseDb('0', 1.5)).toBe(1);
    expect(parseDb('-6', 1.5)).toBeCloseTo(0.501, 3);
    expect(parseDb('+3', 1.5)).toBeCloseTo(1.413, 3);
    expect(parseDb(' -20 dB ', 1.5)).toBeCloseTo(0.1, 6);
  });

  it('round-trips what formatDb shows', () => {
    expect(formatDb(parseDb('-12.5', 1.5)!)).toBe('-12.5');
    expect(formatDb(parseDb('-30', 1.5)!)).toBe('-30.0');
  });

  it('clamps to the fader and reads silence', () => {
    expect(parseDb('+12', 1.5)).toBe(1.5);
    expect(parseDb('-inf', 1.5)).toBe(0);
    expect(parseDb('-∞', 1.5)).toBe(0);
    expect(parseDb('-120', 1.5)).toBe(0);
  });

  it('rejects anything else', () => {
    expect(parseDb('loud', 1.5)).toBeNull();
    expect(parseDb('', 1.5)).toBeNull();
  });
});
