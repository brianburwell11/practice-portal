import { describe, expect, it } from 'vitest';
import { coalesce, editId, type PendingEdit } from './editStore';

const edit = (over: Partial<PendingEdit>): PendingEdit => ({
  id: 'alice|b/songs/s/lyrics.json', userId: 'alice', userName: 'Alice', key: 'b/songs/s/lyrics.json', url: '/api/bands/b/songs/s/lyrics', label: 'Song lyrics', band: 'b', kind: 'whole',
  data: { lines: [] }, base: { lines: [] }, baseRev: 3, state: 'pending', savedAt: 1, ...over,
});

describe('coalesce', () => {
  it('a first save is the edit as it is', () => {
    const e = edit({});
    expect(coalesce(undefined, e)).toBe(e);
  });

  it('a second save keeps one copy, with the new data and the original base', () => {
    const first = edit({ data: { lines: ['one'] }, base: { lines: ['server'] }, baseRev: 3, savedAt: 1 });
    const second = edit({ data: { lines: ['two'] }, base: { lines: ['ignored'] }, baseRev: 9, savedAt: 2 });
    expect(coalesce(first, second)).toEqual({ ...first, data: { lines: ['two'] }, savedAt: 2 });
  });

  it('saving again while it needs a decision keeps it needing one, with the new data', () => {
    const conflict = edit({ state: 'conflict', conflict: { current: { lines: ['theirs'] }, rev: 5 } });
    const merged = coalesce(conflict, edit({ data: { lines: ['newer'] }, savedAt: 7 }));
    expect(merged.state).toBe('conflict');
    expect(merged.conflict).toEqual({ current: { lines: ['theirs'] }, rev: 5 });
    expect(merged.data).toEqual({ lines: ['newer'] });
  });

  it('another account’s save never folds into this one', () => {
    const alice = edit({ data: { lines: ['alice'] } });
    const bob = edit({ id: 'bob|b/songs/s/lyrics.json', userId: 'bob', userName: 'Bob', data: { lines: ['bob'] }, base: { lines: ['b'] }, savedAt: 9 });
    expect(coalesce(alice, bob)).toBe(bob);
  });
});

describe('editId', () => {
  it('is per account and document', () => {
    expect(editId('alice', 'k')).not.toBe(editId('bob', 'k'));
    expect(editId(null, 'k')).toBe('anonymous|k');
  });
});
