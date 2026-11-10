import { describe, expect, it } from 'vitest';
import { chordsFromText, normalizeChord } from './chordSymbols';

describe('normalizeChord', () => {
  it.each([
    ['G', 'G'],
    ['am7', 'Am7'],
    ['c-7', 'Cm7'],
    ['Cmin7', 'Cm7'],
    ['BbM7', 'Bbmaj7'],
    ['bbmaj7', 'Bbmaj7'],
    ['Bb', 'Bb'],
    ['bb', 'Bb'],
    ['b', 'B'],
    ['f#ø', 'F#m7b5'],
    ['F#m7b5', 'F#m7b5'],
    ['d/f#', 'D/F#'],
    ['G/B', 'G/B'],
    ['Am7/G', 'Am7/G'],
    ['nc', 'N.C.'],
    ['N.C.', 'N.C.'],
    ['Csus', 'Csus4'],
    ['D7sus4', 'D7sus4'],
    ['Eb6/9', 'Eb6/9'],
    ['Cm(maj7)', 'Cm(maj7)'],
    ['C°7', 'Cdim7'],
    ['C+', 'Caug'],
    ['Cadd9', 'Cadd9'],
    ['C2', 'Cadd9'],
    ['E7#9', 'E7#9'],
    [' A m ', 'Am'],
    ['F♯m', 'F#m'],
    ['E♭', 'Eb'],
  ])('%s → %s', (input, out) => {
    expect(normalizeChord(input)).toBe(out);
  });

  it.each(['', 'H', 'Xq', 'C/Z', 'Cfoo', 'hello', '12'])('rejects %j', (input) => {
    expect(normalizeChord(input)).toBeNull();
  });
});

describe('chordsFromText', () => {
  it('splits a plain list on spaces, bars and commas', () => {
    expect(chordsFromText('G Em7 | C, D/F#')).toEqual(['G', 'Em7', 'C', 'D/F#']);
  });

  it('pulls chords out of a ChordPro sheet and ignores the words', () => {
    expect(chordsFromText('[G]Morning light [Em7]across\n[C]the [D]floor')).toEqual(['G', 'Em7', 'C', 'D']);
  });
});
