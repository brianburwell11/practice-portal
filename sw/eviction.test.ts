import { describe, expect, it } from 'vitest';
import { mediaIdentity, planEviction, type MediaEntry } from './eviction';

const MB = 1024 * 1024;
const file = (song: string, n: number, mb: number, lastUsed: number): MediaEntry => ({
  key: `/api/media/b/songs/${song}/${n}.opus?v=1`, bytes: mb * MB, band: 'b', song: `b/${song}`, lastUsed,
});

describe('planEviction', () => {
  it('keeps everything under the cap', () => {
    expect(planEviction([file('a', 1, 100, 1), file('b', 1, 100, 2)], 500 * MB)).toEqual([]);
  });

  it('drops whole songs, least recently used first, until it fits', () => {
    const entries = [
      file('old', 1, 150, 10), file('old', 2, 150, 11),  // 300 MB, last used 11
      file('mid', 1, 200, 20),                           // 200 MB, last used 20
      file('new', 1, 200, 30),                           // 200 MB, last used 30
    ];
    // 700 MB against 500: dropping "old" (300) is enough.
    expect(planEviction(entries, 500 * MB).sort()).toEqual([entries[0].key, entries[1].key].sort());
  });

  it("uses a song's most recent play, not its oldest file", () => {
    const entries = [file('a', 1, 300, 1), file('a', 2, 10, 50), file('b', 1, 300, 20)];
    // Song a was played at 50, so b (20) goes first.
    expect(planEviction(entries, 400 * MB)).toEqual([entries[2].key]);
  });

  it('never drops the song being stored, even if it alone is over the cap', () => {
    const entries = [file('big', 1, 600, 1), file('other', 1, 50, 99)];
    expect(planEviction(entries, 500 * MB, 'b/big')).toEqual([entries[1].key]);
  });
});

describe('mediaIdentity', () => {
  it("names a song's band and song from its media path", () => {
    expect(mediaIdentity('/api/media/z17zqzxv/songs/NAf42aR/bass.opus')).toEqual({ band: 'z17zqzxv', song: 'z17zqzxv/NAf42aR' });
  });

  it('ignores anything else', () => {
    expect(mediaIdentity('/api/media/z17zqzxv/assets/logo.png')).toBeNull();
    expect(mediaIdentity('/api/media/z17zqzxv/songs/x/sub/file.opus')).toBeNull();
    expect(mediaIdentity('/api/data/registry.json')).toBeNull();
  });
});
