import { beforeEach, describe, expect, it } from 'vitest';
import { useMarkerEditorStore } from './markerEditorStore';
import type { TapMapEntry } from '../audio/types';

const MAP: TapMapEntry[] = [
  { time: 0, type: 'section', label: 'A' },
  { time: 1, type: 'beat' },
  { time: 2, type: 'measure' },
  { time: 3, type: 'beat' },
  { time: 4, type: 'section', label: 'B' },
];

const store = () => useMarkerEditorStore.getState();

describe('range selection', () => {
  beforeEach(() => store().open(MAP));

  it('deletes every marker inside the range, edges included, as one undo step', () => {
    store().setRangeSelection({ start: 1, end: 3 });
    store().deleteRangeSelection();
    expect(store().tapMap.map((e) => e.time)).toEqual([0, 4]);
    expect(store().rangeSelection).toBeNull();
    expect(store().dirty).toBe(true);
    store().undo();
    expect(store().tapMap).toEqual(MAP);
  });

  it('selecting one marker drops the range, and the other way round', () => {
    store().setRangeSelection({ start: 1, end: 3 });
    store().setSelectedIndex(4);
    expect(store().rangeSelection).toBeNull();
    store().setRangeSelection({ start: 1, end: 3 });
    expect(store().selectedIndex).toBeNull();
  });

  it('an empty range deletes nothing and leaves no undo step', () => {
    store().setRangeSelection({ start: 1.2, end: 1.8 });
    store().deleteRangeSelection();
    expect(store().tapMap).toEqual(MAP);
    expect(store().undoStack).toHaveLength(0);
  });
});
