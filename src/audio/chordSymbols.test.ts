import { describe, expect, it } from 'vitest';
import { chordsFromText, displayChord, normalizeChord } from './chordSymbols';

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
    // Altered triads
    ['Dm#5', 'Dm#5'],
    ['Dm(#5)', 'Dm#5'],
    ['Dm+5', 'Dm#5'],
    ['Cmb6', 'Cmb6'],
    ['C(b5)', 'C(b5)'],
    ['C(#5)', 'Caug'],
    ['C+5', 'Caug'],
    ['Caug', 'Caug'],
    ['Cb5', 'Cb5'],
    ['C5', 'C5'],
    ['Cdim', 'Cdim'],
    ['Co', 'Cdim'],
    // Augmented and major sevenths
    ['C+7', 'C7#5'],
    ['Caug7', 'C7#5'],
    ['C7+', 'C7#5'],
    ['C7+5', 'C7#5'],
    ['C+9', 'C9#5'],
    ['Cmaj7#5', 'Cmaj7#5'],
    ['C+maj7', 'Cmaj7#5'],
    ['Caug(maj7)', 'Cmaj7#5'],
    ['C^7', 'Cmaj7'],
    ['CΔ', 'Cmaj7'],
    ['C^9', 'Cmaj9'],
    ['Cma7', 'Cmaj7'],
    ['CMaj7', 'Cmaj7'],
    ['CMAJ7', 'Cmaj7'],
    ['C7M', 'Cmaj7'],
    ['Cmaj', 'C'],
    ['CM', 'C'],
    ['Cmaj9#11', 'Cmaj9#11'],
    ['Cmaj7(#11)', 'Cmaj7#11'],
    ['Cmaj13', 'Cmaj13'],
    // Minor
    ['C-', 'Cm'],
    ['Cmi7', 'Cm7'],
    ['CmM7', 'Cm(maj7)'],
    ['C-Δ7', 'Cm(maj7)'],
    ['Cm(maj9)', 'Cm(maj9)'],
    ['Cm69', 'Cm6/9'],
    ['Cm6/9', 'Cm6/9'],
    ['Cmadd9', 'Cmadd9'],
    ['Cm(add9)', 'Cmadd9'],
    ['Cm2', 'Cmadd9'],
    ['Cm11', 'Cm11'],
    ['Cm7(11)', 'Cm11'],
    ['Cm7add11', 'Cm7add11'],
    // Half-diminished
    ['Cø', 'Cm7b5'],
    ['Cø7', 'Cm7b5'],
    ['C-7b5', 'Cm7b5'],
    ['Cm7(b5)', 'Cm7b5'],
    ['Cmin7b5', 'Cm7b5'],
    ['Cø9', 'Cm9b5'],
    ['Cdim7', 'Cdim7'],
    ['Co7', 'Cdim7'],
    // Dominant and alterations
    ['C7b9', 'C7b9'],
    ['C7-9', 'C7b9'],
    ['C7+9', 'C7#9'],
    ['C7(b9,#11)', 'C7b9#11'],
    ['C7#11b9', 'C7b9#11'],
    ['C7#9#5', 'C7#5#9'],
    ['C7b9b13', 'C7b9b13'],
    ['C13#11', 'C13#11'],
    ['C13b9', 'C13b9'],
    ['C7alt', 'C7alt'],
    ['Calt', 'C7alt'],
    ['C7(9)', 'C9'],
    ['C7(13)', 'C13'],
    ['C11', 'C11'],
    // Sus, add, omit
    ['C7sus', 'C7sus4'],
    ['C9sus4', 'C9sus4'],
    ['C7b9sus4', 'C7sus4b9'],
    ['C7sus4(b9)', 'C7sus4b9'],
    ['Csus2', 'Csus2'],
    ['C4', 'Csus4'],
    ['Csus4add9', 'Csus4add9'],
    ['Cadd2', 'Cadd9'],
    ['C(add9)', 'Cadd9'],
    ['Cadd11', 'Cadd11'],
    ['Cadd4', 'Cadd11'],
    ['C6add9', 'C6/9'],
    ['C69', 'C6/9'],
    ['C(no3)', 'C(no3)'],
    ['C7no3', 'C7(no3)'],
    ['Cmaj7sus2', 'Cmaj7sus2'],
    // Slash chords on extended chords
    ['Dm#5/F', 'Dm#5/F'],
    ['C6/9/E', 'C6/9/E'],
    ['C7(b9)/E', 'C7b9/E'],
    ['C−7', 'Cm7'],
  ])('%s → %s', (input, out) => {
    expect(normalizeChord(input)).toBe(out);
  });

  it.each([
    '', 'H', 'Xq', 'C/Z', 'Cfoo', 'hello', '12',
    'At', 'Am I', 'Cm5', 'C7#13', 'Csus2sus4', 'Cdim9', 'C5b9', 'Cmmaj', 'Cadd', 'Cno',
  ])('rejects %j', (input) => {
    expect(normalizeChord(input)).toBeNull();
  });

  it('reads every stored spelling back as itself', () => {
    const typed = [
      'Dm#5', 'C(b5)', 'Cb5', 'C7#5', 'Cmaj7#5', 'Cm(maj9)', 'Cm6/9', 'Cmadd9', 'Cm9b5', 'C7b9#11',
      'C7alt', 'C7sus4b9', 'C(no3)', 'C7(no3)', 'C6/9/E', 'Cdim7', 'Caug', 'F#m7b5', 'Bbmaj13',
    ];
    for (const t of typed) {
      const stored = normalizeChord(t)!;
      expect(normalizeChord(stored)).toBe(stored);
      expect(normalizeChord(displayChord(stored))).toBe(stored);
    }
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

describe('displayChord', () => {
  it.each([
    ['Bb', 'B♭'],
    ['F#m7b5', 'F♯m7♭5'],
    ['D/F#', 'D/F♯'],
    ['Ebmaj7/Bb', 'E♭maj7/B♭'],
    ['C7#9', 'C7♯9'],
    ['E7b9', 'E7♭9'],
    ['Cadd9', 'Cadd9'],
    ['Bm', 'Bm'],
    ['Bdim', 'Bdim'],
    ['Absus4', 'A♭sus4'],
    ['N.C.', 'N.C.'],
  ])('%s → %s', (stored, shown) => {
    expect(displayChord(stored)).toBe(shown);
  });

  it('leaves the stored spelling alone for round trips', () => {
    expect(normalizeChord(displayChord('F#m7b5'))).toBe('F#m7b5');
  });
});
