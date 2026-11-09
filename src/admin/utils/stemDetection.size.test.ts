import { describe, expect, it } from 'vitest';
import { MAX_STEM_BYTES, oversizedStemsMessage } from './stemDetection';

const fakeFile = (name: string, size: number) => ({ name, size }) as File;

describe('oversizedStemsMessage', () => {
  it('is null when every file fits', () => {
    expect(oversizedStemsMessage([fakeFile('kick.wav', MAX_STEM_BYTES)])).toBeNull();
  });

  it('names one oversized file', () => {
    expect(oversizedStemsMessage([fakeFile('kick.wav', 10), fakeFile('room.wav', MAX_STEM_BYTES + 1)]))
      .toBe('"room.wav" is over the 1 GB limit for a stem, so it was skipped.');
  });

  it('names several oversized files', () => {
    const big = MAX_STEM_BYTES + 1;
    expect(oversizedStemsMessage([fakeFile('a.wav', big), fakeFile('b.wav', big)]))
      .toBe('"a.wav", "b.wav" are over the 1 GB limit for a stem, so they were skipped.');
  });
});
