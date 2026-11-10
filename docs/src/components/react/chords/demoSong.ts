/**
 * A made-up 17-bar song in G for the chord widgets: a tapMap of beat times
 * with a little human drift, a chord chart anchored to bar and beat, and
 * lyric lines in the app's `{ text, time }` shape.
 */

export const BEATS_PER_BAR = 4;
export const BARS = 17;
export const BPM = 92;
/** The tapMap starts here. Before it is a free-time intro: chords, no bars or beats. */
export const LEAD_IN = 4.6;
export const KEY_PC = 7; // G

/** Build beat times (seconds) the way a hand-tapped tapMap looks: close to
 *  steady, but not quite. `stretch` scales everything, `shiftFromBar` moves
 *  every beat from that bar on, for the "edit the tapMap" demo. */
export function makeBeats(opts: { stretch?: number; shiftFromBar?: number; shiftBy?: number } = {}): number[] {
  const { stretch = 1, shiftFromBar = Infinity, shiftBy = 0 } = opts;
  const out: number[] = [];
  let t = LEAD_IN;
  const base = 60 / BPM;
  for (let i = 0; i < BARS * BEATS_PER_BAR; i++) {
    const bar = Math.floor(i / BEATS_PER_BAR);
    out.push(t * stretch + (bar >= shiftFromBar ? shiftBy : 0));
    t += base * (1 + 0.035 * Math.sin(i / 7) + 0.012 * Math.sin(i * 1.7));
  }
  return out;
}

export const BEATS = makeBeats();
export const SONG_END = BEATS[BEATS.length - 1] + 60 / BPM;

export interface GridChord {
  /** 0-based bar. */
  bar: number;
  /** 0-based beat within the bar. */
  beat: number;
  symbol: string;
  /** Pushed (anticipated): sounds half a beat early, on the "and" before. */
  push?: boolean;
}

export const CHART: GridChord[] = [
  { bar: 0, beat: 0, symbol: 'G' },
  { bar: 2, beat: 0, symbol: 'Em7' },
  { bar: 4, beat: 0, symbol: 'Cmaj7' },
  { bar: 5, beat: 0, symbol: 'D/F#' },
  { bar: 6, beat: 0, symbol: 'G' },
  { bar: 7, beat: 0, symbol: 'Am7' },
  { bar: 7, beat: 2, symbol: 'D7' },
  { bar: 8, beat: 0, symbol: 'C', push: true },
  { bar: 9, beat: 0, symbol: 'D' },
  { bar: 10, beat: 0, symbol: 'Bm7' },
  { bar: 11, beat: 0, symbol: 'Em7' },
  { bar: 12, beat: 0, symbol: 'C', push: true },
  { bar: 13, beat: 0, symbol: 'D/F#' },
  { bar: 14, beat: 0, symbol: 'G' },
  { bar: 14, beat: 2, symbol: 'Em' },
  { bar: 15, beat: 0, symbol: 'Am7' },
  { bar: 15, beat: 2, symbol: 'D7sus4' },
  { bar: 16, beat: 0, symbol: 'G', push: true },
];

export interface TimedChord {
  time: number;
  symbol: string;
  bar?: number;
  beat?: number;
}

export function beatIndex(bar: number, beat: number): number {
  return bar * BEATS_PER_BAR + beat;
}

/** Fractional beat position of a grid chord (a push is half a beat early). */
export function chartPos(c: GridChord): number {
  return beatIndex(c.bar, c.beat) - (c.push ? 0.5 : 0);
}

/** Seconds at a fractional beat position, interpolating between taps. */
export function timeAtPos(beats: number[], p: number): number {
  const i = Math.max(0, Math.min(beats.length - 2, Math.floor(p)));
  return beats[i] + (p - i) * (beats[i + 1] - beats[i]);
}

/** Seconds for each grid chord, read off the given beat times. */
export function timeChart(chart: GridChord[], beats: number[] = BEATS): TimedChord[] {
  return chart
    .map((c) => ({ ...c, time: timeAtPos(beats, chartPos(c)) }))
    .sort((a, b) => a.time - b.time);
}

/** The free-time intro: stamped by ear, nothing to snap to. */
export const FREE_INTRO: TimedChord[] = [
  { time: 0.4, symbol: 'Cmaj7' },
  { time: 2.55, symbol: 'D7sus4' },
];

/** Just the chords on the beat grid. */
export const GRID_TIMED = timeChart(CHART);
/** Everything, free-time intro included. */
export const TIMED = [...FREE_INTRO, ...GRID_TIMED];

export interface LyricLine {
  text: string;
  time: number;
}

const LYRIC_SPOTS: [number, number, string][] = [
  [0, 2, 'Morning light across the kitchen floor'],
  [2, 2, "Coffee's cold, I'm running late once more"],
  [4, 2, 'Radio is playing something slow'],
  [6, 2, 'Hum along and let the hours go'],
  [8, 0, 'Hold on, hold on'],
  [10, 0, 'Every little thing will find its way'],
  [12, 0, 'Hold on, hold on'],
  [14, 0, 'Let it ride another day'],
];

export const LYRICS: LyricLine[] = LYRIC_SPOTS.map(([bar, beat, text]) => ({
  text,
  time: BEATS[beatIndex(bar, beat)],
}));

/** Index of the last item at or before `t`, or -1. */
export function lastAtOrBefore<T extends { time: number }>(items: T[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Fractional beat position (e.g. 13.4) for a time, using the beat grid. */
export function beatPosition(t: number, beats: number[] = BEATS): number {
  if (t < beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  const i = Math.max(0, lastAtOrBefore(beats.map((time) => ({ time })), t));
  const next = beats[i + 1] ?? beats[i] + (beats[i] - beats[i - 1]);
  return i + (t - beats[i]) / (next - beats[i]);
}

export type Snap = 'off' | 'beat' | 'half' | 'quarter';
const DIV: Record<Snap, number> = { off: 0, beat: 1, half: 2, quarter: 4 };

/** True where there's no beat grid: before the first tap or after the last. */
export function isFreeTime(t: number, beats: number[] = BEATS): boolean {
  const gap = beats[1] - beats[0];
  return t < beats[0] - gap / 4 || t > beats[beats.length - 1] + gap;
}

/** Snap a time to the beat grid. Free time is left exactly where it was. */
export function snapTime(t: number, snap: Snap, beats: number[] = BEATS): number {
  if (snap === 'off' || isFreeTime(t, beats)) return t;
  const d = DIV[snap];
  const p = Math.round(beatPosition(t, beats) * d) / d;
  return timeAtPos(beats, Math.max(0, p));
}

/** "Bar 5, beat 3" style label (1-based); "3.&" for an off-beat. */
export function barBeatLabel(t: number, beats: number[] = BEATS): string {
  if (isFreeTime(t, beats)) return 'free time';
  const p = Math.max(0, beatPosition(t, beats));
  const i = Math.floor(p + 1e-6);
  const and = p - i > 0.4 && p - i < 0.6 ? '&' : '';
  return `${Math.floor(i / BEATS_PER_BAR) + 1}.${(i % BEATS_PER_BAR) + 1}${and}`;
}
