import { beforeEach, describe, expect, it } from 'vitest';
import { useChordsEditorStore } from './chordsEditorStore';

const store = () => useChordsEditorStore.getState();
const symbols = () => store().chords.map((c) => `${c.symbol}@${c.time}`);

// Beats every second from 10 to 18.
const grid = Array.from({ length: 9 }, (_, i) => ({ time: 10 + i, bar: i % 4 === 0 }));

describe('chordsEditorStore', () => {
  beforeEach(() => store().open([{ symbol: 'G', time: 10 }, { symbol: 'C', time: 14 }]));

  it('opens clean, sorted, in grid mode', () => {
    store().close();
    store().open([{ symbol: 'C', time: 14 }, { symbol: 'G', time: 10 }]);
    expect(symbols()).toEqual(['G@10', 'C@14']);
    expect(store()).toMatchObject({ mode: 'grid', dirty: false, isOpen: true });
  });

  it('places, replaces and removes chords as single undo steps', () => {
    store().applyEdit([], [{ symbol: 'D', time: 12 }]);
    expect(symbols()).toEqual(['G@10', 'D@12', 'C@14']);
    store().applyEdit([], [{ symbol: 'Em', time: 12.004 }]); // same spot replaces
    expect(symbols()).toEqual(['G@10', 'Em@12.004', 'C@14']);
    store().applyEdit([14], []);
    expect(symbols()).toEqual(['G@10', 'Em@12.004']);
    store().undo();
    store().undo();
    expect(symbols()).toEqual(['G@10', 'D@12', 'C@14']);
    store().redo();
    expect(symbols()).toEqual(['G@10', 'Em@12.004', 'C@14']);
    expect(store().dirty).toBe(true);
  });

  it('stamps the queue in order and takes stamps back to the front', () => {
    store().setQueue(['Cmaj7', 'D7sus4']);
    expect(store().stamp(1.2345)).toBe(true);
    expect(store().stamp(3)).toBe(true);
    expect(store().stamp(5)).toBe(false); // queue empty
    expect(symbols()).toEqual(['Cmaj7@1.235', 'D7sus4@3', 'G@10', 'C@14']);
    store().takeBack();
    expect(store().queue).toEqual(['D7sus4']);
    expect(symbols()).toEqual(['Cmaj7@1.235', 'G@10', 'C@14']);
    store().undo(); // undoing the take-back restores the stamp and the queue
    expect(store().queue).toEqual([]);
    expect(symbols()).toContain('D7sus4@3');
  });

  it('nudges a chord without passing its neighbours', () => {
    store().nudge(10, 0.25);
    expect(symbols()).toEqual(['G@10.25', 'C@14']);
    expect(store().selected).toBe(10.25);
    store().nudge(10.25, 99);
    expect(symbols()).toEqual(['G@13.99', 'C@14']);
    store().nudge(13.99, -99);
    expect(symbols()).toEqual(['G@0', 'C@14']);
  });

  it('snaps chords a tapMap edit left off the grid, keeping pushes and free time', () => {
    store().open([
      { symbol: 'Intro', time: 3.3 }, // free time
      { symbol: 'G', time: 10.2 }, // off grid
      { symbol: 'D', time: 12.5 }, // push, on grid
      { symbol: 'C', time: 14.31 }, // off grid
    ]);
    expect(store().snapOffGrid(grid)).toBe(2);
    expect(symbols()).toEqual(['Intro@3.3', 'G@10', 'D@12.5', 'C@14.5']);
    expect(store().snapOffGrid(grid)).toBe(0);
  });

  it('remembers the snap setting', () => {
    store().setSnap('quarter');
    expect(store().snap).toBe('quarter');
    expect(window.localStorage.getItem('practice-portal.chordSnap')).toBe('quarter');
  });
});
