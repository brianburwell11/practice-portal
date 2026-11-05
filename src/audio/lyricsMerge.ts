import type { LyricsLine } from './lyricsTypes';
import { isInstrumentalAnnotation } from './lyricSections';

/** The text form of lyrics: one line per lyric, instrumental lines as
 *  `#INSTRUMENTAL`. Same shape as the .txt export. */
export function linesToText(lines: LyricsLine[]): string {
  return lines.map((l) => (l.instrumental ? '#INSTRUMENTAL' : l.text)).join('\n');
}

/** Parse lyrics text into untimed lines. `[Instrumental]` / `#INSTRUMENTAL`
 *  (any case) become instrumental lines; everything else is trimmed. */
export function textToLines(text: string): LyricsLine[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split('\n').map((raw) => {
    const t = raw.trim();
    if (isInstrumentalAnnotation(t)) return { text: '', time: null, instrumental: true };
    return { text: t, time: null };
  });
}

function key(line: LyricsLine): string {
  return line.instrumental ? '#INSTRUMENTAL' : line.text.trim();
}

/**
 * Carry timestamps from `baseline` onto `next` for every line whose text
 * is unchanged, matched in order with a longest-common-subsequence so
 * inserted, deleted and edited lines don't shift the rest. Changed and
 * new lines come back untimed.
 */
export function mergeLyricTimes(baseline: LyricsLine[], next: LyricsLine[]): LyricsLine[] {
  const a = baseline.map(key);
  const b = next.map(key);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = next.map((l) => ({ ...l, time: null as number | null }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out[j].time = baseline[i].time;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}
