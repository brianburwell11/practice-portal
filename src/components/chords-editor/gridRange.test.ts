import { describe, expect, it } from 'vitest';
import { chordsInRange, copyRange, pasteEdit } from './gridRange';

// Beats every second from 10 to 18: bar 1 = cells 0-3, bar 2 = 4-7, final bar line 8.
const grid = Array.from({ length: 9 }, (_, i) => ({ time: 10 + i, bar: i % 4 === 0 }));
const chords = [
  { symbol: 'Intro', time: 3 }, // free time
  { symbol: 'G', time: 10 },
  { symbol: 'Em', time: 12 },
  { symbol: 'C', time: 13.5 }, // pushed onto cell 4
  { symbol: 'D', time: 16 },
];

describe('chordsInRange', () => {
  it('counts a push in the cell it is written in, and never free time', () => {
    expect(chordsInRange(chords, grid, 0, 3)).toEqual([10, 12]);
    expect(chordsInRange(chords, grid, 4, 4)).toEqual([13.5]);
    expect(chordsInRange(chords, grid, 3, 0)).toEqual([10, 12]); // either direction
  });
});

describe('copyRange', () => {
  it('records offsets and pushes, spanning empty beats', () => {
    expect(copyRange(chords, grid, 4, 7)).toEqual({
      length: 4,
      items: [{ offset: 0, symbol: 'C', push: true }, { offset: 2, symbol: 'D', push: false }],
    });
  });
});

describe('pasteEdit', () => {
  it('replaces the span beat for beat, keeping pushes as pushes', () => {
    const clip = copyRange(chords, grid, 4, 7);
    expect(pasteEdit(chords, grid, clip, 0)).toEqual({
      remove: [10, 12],
      add: [{ symbol: 'C', time: 9.5 }, { symbol: 'D', time: 12 }],
      end: 3,
    });
  });

  it('stops at the end of the grid', () => {
    const clip = copyRange(chords, grid, 0, 3);
    const edit = pasteEdit(chords, grid, clip, 7);
    expect(edit.end).toBe(8);
    expect(edit.add).toEqual([{ symbol: 'G', time: 17 }]);
  });
});
