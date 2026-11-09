import { describe, expect, it } from 'vitest';
import { formatPan, parsePan } from './useStemControls';

describe('parsePan', () => {
  it('reads what formatPan shows', () => {
    expect(parsePan('C')).toBe(0);
    expect(parsePan('L42')).toBe(-0.42);
    expect(parsePan('r18')).toBe(0.18);
    expect(formatPan(parsePan('L7')!)).toBe('L7');
  });

  it('reads words and signed numbers', () => {
    expect(parsePan('left 30')).toBe(-0.3);
    expect(parsePan('center')).toBe(0);
    expect(parsePan('-25')).toBe(-0.25);
    expect(parsePan('25')).toBe(0.25);
  });

  it('clamps and rejects', () => {
    expect(parsePan('L150')).toBe(-1);
    expect(parsePan('up')).toBeNull();
  });
});
