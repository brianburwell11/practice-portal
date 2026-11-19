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

/** Lines that can carry a time: lyrics and instrumentals, not blanks or #MARKERS. */
function stampable(line: LyricsLine): boolean {
  if (line.instrumental) return true;
  const t = line.text.trim();
  return t !== '' && !t.startsWith('#');
}

function bigrams(s: string): Map<string, number> {
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character bigrams, 0..1. */
function similarity(a: LyricsLine, b: LyricsLine): number {
  if (!!a.instrumental !== !!b.instrumental) return 0;
  if (a.instrumental) return 1;
  const x = bigrams(a.text);
  const y = bigrams(b.text);
  let both = 0;
  let total = 0;
  for (const [g, c] of x) { total += c; both += Math.min(c, y.get(g) ?? 0); }
  for (const c of y.values()) total += c;
  return total === 0 ? 0 : (2 * both) / total;
}

const MIN_SIMILARITY = 0.4;

/**
 * Inside a run of removed baseline lines and added new lines, decide which
 * added lines are edits of removed ones and carry their times over. Same
 * number of lines on both sides reads as editing in place, paired in order.
 * Otherwise lines pair in order by how alike they are, so an inserted line
 * next to an edited one doesn't steal its time.
 */
function pairEdits(baseline: LyricsLine[], removed: number[], out: LyricsLine[], added: number[]) {
  const r = removed.filter((i) => stampable(baseline[i]) && baseline[i].time !== null);
  const a = added.filter((j) => stampable(out[j]));
  if (r.length === 0 || a.length === 0) return;

  if (r.length === a.length) {
    r.forEach((i, k) => {
      if (!!baseline[i].instrumental === !!out[a[k]].instrumental) out[a[k]].time = baseline[i].time;
    });
    return;
  }

  // Monotone alignment maximizing total similarity (runs are tiny).
  const sim = r.map((i) => a.map((j) => {
    const s = similarity(baseline[i], out[j]);
    return s >= MIN_SIMILARITY ? s : 0;
  }));
  const best: Float64Array[] = Array.from({ length: r.length + 1 }, () => new Float64Array(a.length + 1));
  for (let x = r.length - 1; x >= 0; x--) {
    for (let y = a.length - 1; y >= 0; y--) {
      best[x][y] = Math.max(best[x + 1][y], best[x][y + 1], sim[x][y] > 0 ? sim[x][y] + best[x + 1][y + 1] : 0);
    }
  }
  let x = 0;
  let y = 0;
  while (x < r.length && y < a.length) {
    if (sim[x][y] > 0 && best[x][y] === sim[x][y] + best[x + 1][y + 1]) {
      out[a[y]].time = baseline[r[x]].time;
      x++;
      y++;
    } else if (best[x][y] === best[x + 1][y]) {
      x++;
    } else {
      y++;
    }
  }
}

/**
 * Carry timestamps from `baseline` onto `next`. Unchanged lines are matched
 * in order with a longest-common-subsequence so inserted and deleted lines
 * don't shift the rest. Between those anchors, a changed line keeps the
 * time of the line it replaced (see pairEdits), so fixing a typo doesn't
 * mean restamping. Genuinely new lines come back untimed.
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
  let removed: number[] = [];
  let added: number[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      pairEdits(baseline, removed, out, added);
      removed = [];
      added = [];
      out[j].time = baseline[i].time;
      i++;
      j++;
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) {
      removed.push(i++);
    } else {
      added.push(j++);
    }
  }
  pairEdits(baseline, removed, out, added);
  return out;
}
