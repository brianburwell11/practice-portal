import { describe, expect, it } from 'vitest';
import { mergeConfig, mergeKindOf, resolveConflict, sameDoc } from './merge';

const base = { title: 'Song', tapMap: [{ t: 1 }], stems: [{ id: 'bass', volume: 0 }], markers: [] };

describe('sameDoc', () => {
  it('ignores key order', () => {
    expect(sameDoc({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
  });
  it('sees array order', () => {
    expect(sameDoc([1, 2], [2, 1])).toBe(false);
  });
});

describe('mergeConfig', () => {
  it('takes my tapMap and their mix when each changed a different part', () => {
    const mine = { ...base, tapMap: [{ t: 1 }, { t: 2 }] };
    const theirs = { ...base, stems: [{ id: 'bass', volume: -6 }] };
    expect(mergeConfig(base, mine, theirs)).toEqual({
      ok: true,
      merged: { ...base, tapMap: [{ t: 1 }, { t: 2 }], stems: [{ id: 'bass', volume: -6 }] },
    });
  });

  it('reports the parts both changed, differently', () => {
    const mine = { ...base, tapMap: [{ t: 2 }], stems: [{ id: 'bass', volume: 3 }] };
    const theirs = { ...base, tapMap: [{ t: 3 }], stems: [{ id: 'bass', volume: 3 }] };
    expect(mergeConfig(base, mine, theirs)).toEqual({ ok: false, keys: ['tapMap'] });
  });

  it('keeps a key one side added, and drops one a side removed', () => {
    const mine = { ...base, videos: [{ id: 'v' }] };
    const theirs = Object.fromEntries(Object.entries(base).filter(([k]) => k !== 'markers'));
    const result = mergeConfig(base, mine, theirs);
    expect(result).toEqual({ ok: true, merged: { title: 'Song', tapMap: [{ t: 1 }], stems: [{ id: 'bass', volume: 0 }], videos: [{ id: 'v' }] } });
  });
});

describe('resolveConflict', () => {
  it('config: resends the merge when the parts are separate', () => {
    const mine = { ...base, tapMap: [{ t: 9 }] };
    const theirs = { ...base, title: 'Renamed' };
    expect(resolveConflict('config', base, mine, theirs)).toEqual({ type: 'resend', data: { ...base, tapMap: [{ t: 9 }], title: 'Renamed' } });
  });

  it('config: done when the server already has my change (a save that went through but never answered)', () => {
    const mine = { ...base, tapMap: [{ t: 9 }] };
    expect(resolveConflict('config', base, mine, mine)).toEqual({ type: 'done' });
    // ...or theirs has my change plus theirs: merged equals theirs.
    const theirs = { ...mine, title: 'Renamed' };
    expect(resolveConflict('config', base, mine, theirs)).toEqual({ type: 'done' });
  });

  it('config: conflict with the parts named', () => {
    const mine = { ...base, markers: [{ name: 'A' }] };
    const theirs = { ...base, markers: [{ name: 'B' }] };
    expect(resolveConflict('config', base, mine, theirs)).toEqual({ type: 'conflict', keys: ['markers'] });
  });

  it('lyrics: resends mine if theirs is still the base', () => {
    const lyricsBase = { lines: [{ text: 'a' }] };
    const mine = { lines: [{ text: 'b' }] };
    expect(resolveConflict('whole', lyricsBase, mine, { lines: [{ text: 'a' }] })).toEqual({ type: 'resend', data: mine });
  });

  it('lyrics: conflict if both changed them', () => {
    expect(resolveConflict('whole', { lines: [] }, { lines: [{ text: 'mine' }] }, { lines: [{ text: 'theirs' }] }))
      .toEqual({ type: 'conflict' });
  });

  it('lyrics that didn’t exist (null base): mine goes in if theirs still don’t exist', () => {
    expect(resolveConflict('whole', null, { lines: [{ text: 'new' }] }, null)).toEqual({ type: 'resend', data: { lines: [{ text: 'new' }] } });
  });

  it('asks when the base isn’t known', () => {
    expect(resolveConflict('whole', undefined, { lines: [1] }, { lines: [2] })).toEqual({ type: 'conflict' });
  });
});

describe('mergeKindOf', () => {
  it('config by key, everything else whole', () => {
    expect(mergeKindOf('b/songs/s/config.json')).toBe('config');
    expect(mergeKindOf('b/songs/s/lyrics.json')).toBe('whole');
  });
});
