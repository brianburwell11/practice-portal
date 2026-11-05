import { describe, expect, it } from 'vitest';
import type { LyricsLine } from './lyricsTypes';
import { linesToText, mergeLyricTimes, textToLines } from './lyricsMerge';

const timed: LyricsLine[] = [
  { text: '#VERSE', time: null },
  { text: 'first line', time: 1 },
  { text: 'second line', time: 2 },
  { text: '', time: null },
  { text: '', time: 3, instrumental: true },
  { text: 'chorus', time: 4 },
  { text: 'chorus', time: 5 },
];

const times = (lines: LyricsLine[]) => lines.map((l) => l.time);
const edit = (fn: (rows: string[]) => string[]) =>
  mergeLyricTimes(timed, textToLines(fn(linesToText(timed).split('\n')).join('\n')));

describe('lyrics text round trip', () => {
  it('keeps every line and time when nothing changes', () => {
    expect(mergeLyricTimes(timed, textToLines(linesToText(timed)))).toEqual(timed);
  });

  it('writes instrumental lines as #INSTRUMENTAL and reads them back', () => {
    expect(linesToText(timed).split('\n')[4]).toBe('#INSTRUMENTAL');
    expect(textToLines('[Instrumental]')[0]).toEqual({ text: '', time: null, instrumental: true });
  });
});

describe('mergeLyricTimes', () => {
  it('clears only the line that was edited', () => {
    const out = edit((r) => r.map((x) => (x === 'second line' ? 'second line, fixed' : x)));
    expect(times(out)).toEqual([null, 1, null, null, 3, 4, 5]);
  });

  it('keeps times around an inserted line', () => {
    const out = edit((r) => [...r.slice(0, 2), 'new line', ...r.slice(2)]);
    expect(times(out)).toEqual([null, 1, null, 2, null, 3, 4, 5]);
  });

  it('keeps times around a deleted line', () => {
    const out = edit((r) => r.filter((x) => x !== 'first line'));
    expect(times(out)).toEqual([null, 2, null, 3, 4, 5]);
  });

  it('matches repeated lines in order', () => {
    const out = edit((r) => [...r, 'chorus']);
    expect(times(out)).toEqual([null, 1, 2, null, 3, 4, 5, null]);
  });

  it('restores a time when a line is typed back to its old text', () => {
    const changed = edit((r) => r.map((x) => (x === 'first line' ? 'first' : x)));
    expect(changed[1].time).toBeNull();
    const retyped = linesToText(changed).replace(/^first$/m, 'first line');
    const back = mergeLyricTimes(timed, textToLines(retyped));
    expect(times(back)).toEqual(times(timed));
  });
});
