import { currentMeasureIndex } from '../../audio/tempoUtils';
import type { TapMapEntry } from '../../audio/types';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { writtenOf } from './scorePosition';

/**
 * The part of one written measure inside the A/B loop, in beats from its
 * downbeat (0 to `beats`). Positions between beats (an unsnapped loop end)
 * are fractional.
 */
export interface LoopSpan {
  /** Written measure index (into the score's measures). */
  written: number;
  from: number;
  to: number;
  /** Beats the tapMap gives this measure (1 when only its downbeat is tapped). */
  beats: number;
  /** The loop starts in this span: draw its left edge. */
  isStart: boolean;
  /** The loop ends in this span: draw its right edge. */
  isEnd: boolean;
}

/** A loop end this close to a beat (in beats) is on it. */
const BEAT_SNAP = 0.02;

/**
 * Each played measure's tap times: its downbeat, then its beats. Indexed
 * like `measureStartTimes` (one entry per measure or section tap).
 */
export function measureBeatTimes(tapMap: readonly TapMapEntry[] | undefined): number[][] {
  const out: number[][] = [];
  if (!tapMap) return out;
  for (const t of tapMap) {
    if (t.type === 'measure' || t.type === 'section') out.push([t.time]);
    else if (out.length > 0) out[out.length - 1].push(t.time);
  }
  return out;
}

/** Where `seconds` is in played measure `p`, in beats from its downbeat (0 to its beat count). */
function beatPosition(seconds: number, p: number, beatTimes: readonly number[][]): number {
  const beats = beatTimes[p];
  const n = beats.length;
  const next = beatTimes[p + 1]?.[0];
  // The last measure has no next downbeat: give its last beat the average
  // beat's length (or 1 s with only a downbeat), as the cursor does.
  const end = next ?? (n > 1 ? beats[n - 1] + (beats[n - 1] - beats[0]) / (n - 1) : beats[0] + 1);
  if (seconds <= beats[0]) return 0;
  if (seconds >= end) return n;
  let k = 0;
  while (k + 1 < n && beats[k + 1] <= seconds) k++;
  const t1 = beats[k + 1] ?? end;
  const pos = k + (seconds - beats[k]) / Math.max(0.001, t1 - beats[k]);
  const near = Math.round(pos);
  return Math.abs(pos - near) < BEAT_SNAP ? near : pos;
}

/**
 * The written measures the loop from `a` to `b` (seconds) covers, and how far
 * into each. Played measures are walked in order (repeats unfolded), then
 * mapped to the written ones; a written measure played twice in the loop
 * gets one span covering both. Empty without a loop or enough timing.
 */
export function loopSpans(
  a: number | null,
  b: number | null,
  beatTimes: readonly number[][],
  unfolded: readonly UnfoldedStep[],
  writtenCount: number,
): LoopSpan[] {
  if (a === null || b === null || b <= a || beatTimes.length < 2 || writtenCount <= 0) return [];
  const downbeats = beatTimes.map((m) => m[0]);
  const playedCount = Math.min(beatTimes.length, unfolded.length > 0 ? unfolded.length : writtenCount);
  if (playedCount <= 0) return [];

  const pA = currentMeasureIndex(a, downbeats);
  if (pA >= playedCount) return [];
  const fromA = beatPosition(a, pA, beatTimes);
  let pB = currentMeasureIndex(b, downbeats);
  let toB: number;
  if (pB >= playedCount) {
    pB = playedCount - 1;
    toB = beatTimes[pB].length;
  } else {
    toB = beatPosition(b, pB, beatTimes);
    // Ending on a downbeat: the loop ends at the barline before it.
    if (toB <= 0 && pB > pA) {
      pB--;
      toB = beatTimes[pB].length;
    }
  }

  const byWritten = new Map<number, LoopSpan>();
  const order: number[] = [];
  for (let p = pA; p <= pB; p++) {
    const beats = beatTimes[p].length;
    const from = p === pA ? fromA : 0;
    const to = p === pB ? toB : beats;
    if (to <= from) continue;
    const written = writtenOf(p, unfolded);
    if (written < 0 || written >= writtenCount) continue;
    const prev = byWritten.get(written);
    if (prev) {
      // Played again in the loop: cover both, in the first pass's beats.
      prev.from = Math.min(prev.from, (from / beats) * prev.beats);
      prev.to = Math.max(prev.to, (to / beats) * prev.beats);
      prev.isStart ||= p === pA;
      prev.isEnd ||= p === pB;
    } else {
      byWritten.set(written, { written, from, to, beats, isStart: p === pA, isEnd: p === pB });
      order.push(written);
    }
  }
  return order.map((w) => byWritten.get(w)!);
}

/** A measure whose first beat is this far past its left edge starts a system (clef, key...). */
const HEADER_MIN_PX = 12;
/** The highlight starts this far before a beat's note, like the cursor's measure box. */
const LEAD_PX = 4;

/**
 * Where a span's highlight starts and ends (px), in a measure from `left` to
 * `right` whose first beat is at `beat`. `beatXs` are where MuseScore puts
 * each beat (px, index 0 is the downbeat), null where it has none; beats it
 * can't place are spaced evenly. A span from the downbeat starts at the
 * barline, so measures in a row join up (or just before the first note, past
 * a system's clef and key).
 */
export function spanEdges(
  span: LoopSpan,
  left: number,
  beat: number,
  right: number,
  beatXs: readonly (number | null)[] | null,
): { x0: number; x1: number } {
  const first = beat - left > HEADER_MIN_PX ? beat - LEAD_PX : left;
  const n = Math.max(1, span.beats);
  const edges = [first];
  for (let k = 1; k < n; k++) {
    const prev = edges[k - 1];
    const even = beat + (k / n) * (right - beat) - LEAD_PX;
    const raw = beatXs?.[k];
    const placed = raw != null && raw - LEAD_PX > prev && raw - LEAD_PX < right ? raw - LEAD_PX : even;
    edges.push(Math.max(prev, placed));
  }
  edges.push(right);
  const at = (pos: number) => {
    const p = Math.max(0, Math.min(n, pos));
    const k = Math.min(n - 1, Math.floor(p));
    return edges[k] + (p - k) * (edges[k + 1] - edges[k]);
  };
  const x0 = at(span.from);
  return { x0, x1: Math.max(x0 + 2, at(span.to)) };
}

/** How the loop is shaded: a gold multiplied into white paper, or screened into dark pages. */
export const LOOP_SHADE = {
  light: { fill: '#FFE57A', blend: 'multiply', edge: '#D4A50C' },
  dark: { fill: '#8C6A08', blend: 'screen', edge: '#F0C53A' },
} as const;
