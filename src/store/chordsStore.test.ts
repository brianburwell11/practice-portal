import { beforeEach, describe, expect, it } from 'vitest';
import { useChordsStore } from './chordsStore';

describe('chordsStore', () => {
  beforeEach(() => useChordsStore.getState().clear());

  it('sorts chords by time and drops blank symbols', () => {
    useChordsStore.getState().setChords([
      { symbol: 'D', time: 4 },
      { symbol: ' ', time: 3 },
      { symbol: 'G', time: 1 },
    ]);
    const s = useChordsStore.getState();
    expect(s.chords.map((c) => c.symbol)).toEqual(['G', 'D']);
    expect(s.loaded).toBe(true);
  });

  it('clear forgets the chords and marks them not loaded', () => {
    useChordsStore.getState().setChords([{ symbol: 'G', time: 1 }]);
    useChordsStore.getState().clear();
    expect(useChordsStore.getState()).toMatchObject({ chords: [], loaded: false });
  });
});
