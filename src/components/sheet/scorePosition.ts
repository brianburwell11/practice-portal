import { currentMeasureIndex } from '../../audio/tempoUtils';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';

/**
 * Where playback is in the score, shared by every view of it (the scrolling
 * strip, the page view) so their cursors always agree.
 *
 * Two kinds of measure index:
 * - played: the order the audio goes through the measures, repeats and
 *   jumps unfolded. The tapMap has one downbeat per played measure.
 * - written: the measure as printed, an index into the score's measures
 *   (and into any per-measure geometry, like `measureXs`).
 * `unfolded[played].srcIndex` maps one to the other; without repeats
 * `unfolded` is empty and they are the same.
 */
export interface ScorePosition {
  /** Played measure index (into the tapMap's measure downbeats). */
  playedIndex: number;
  /** Written measure index (into the score's measures). */
  writtenIndex: number;
  /** How far through the measure, 0 to 1, by the tapped downbeats. */
  fraction: number;
  /** The next played measure isn't the next written one (a repeat or a jump),
   *  so a cursor should snap to it rather than slide. */
  jumpsNext: boolean;
}

/** Playback has gone past the score's last measure (the tapMap is longer than the score). */
export const PAST_END = 'past-end' as const;

/**
 * The score position at `seconds` of audio.
 *
 * Returns null without enough timing (fewer than two measure downbeats), and
 * `PAST_END` once playback is past the score's last played measure.
 * `writtenCount` is the number of written measures, used as the score's
 * length when it has no repeats.
 */
export function scorePositionAt(
  seconds: number,
  measureTimes: readonly number[],
  unfolded: readonly UnfoldedStep[],
  writtenCount: number,
): ScorePosition | typeof PAST_END | null {
  if (measureTimes.length < 2) return null;
  const playedCount = unfolded.length > 0 ? unfolded.length : writtenCount;
  const playedIndex = currentMeasureIndex(seconds, measureTimes as number[]);
  if (playedIndex >= playedCount) return PAST_END;

  const writtenIndex = writtenOf(playedIndex, unfolded);
  const nextWritten = playedIndex + 1 < playedCount ? writtenOf(playedIndex + 1, unfolded) : writtenIndex + 1;
  const t0 = measureTimes[playedIndex];
  const t1 = measureTimes[playedIndex + 1] ?? t0 + 1;
  const fraction = Math.max(0, Math.min(1, (seconds - t0) / Math.max(0.001, t1 - t0)));
  return { playedIndex, writtenIndex, fraction, jumpsNext: nextWritten !== writtenIndex + 1 };
}

/** The written measure a played measure shows. */
export function writtenOf(playedIndex: number, unfolded: readonly UnfoldedStep[]): number {
  return unfolded.length > 0 ? (unfolded[playedIndex]?.srcIndex ?? playedIndex) : playedIndex;
}

/**
 * The first time a written measure is played: where clicking it seeks to,
 * and where a scrolled-to measure counts as reached.
 */
export function firstPlayedIndex(writtenIndex: number, unfolded: readonly UnfoldedStep[]): number {
  if (unfolded.length === 0) return writtenIndex;
  const first = unfolded.findIndex((s) => s.srcIndex === writtenIndex);
  return first >= 0 ? first : writtenIndex;
}

/** A point on the sheet music: a played measure and a tapped beat in it (0 = its downbeat). */
export interface BeatPoint {
  played: number;
  beat: number;
}

/**
 * The played occurrence of a written measure nearest played measure `near`
 * (on a tie, the one after it), so a loop drawn across a repeated measure
 * stays inside one pass.
 */
export function playedNear(written: number, near: number, unfolded: readonly UnfoldedStep[]): number {
  if (unfolded.length === 0) return written;
  const cost = (i: number) => Math.abs(i - near) * 2 + (i < near ? 1 : 0);
  let best = -1;
  unfolded.forEach((s, i) => {
    if (s.srcIndex === written && (best < 0 || cost(i) < cost(best))) best = i;
  });
  return best >= 0 ? best : written;
}

/** Which beat of a measure `x` falls in: the last beat starting at or before it (`beatXs` null where unknown). */
export function beatAtX(x: number, beatXs: readonly (number | null)[]): number {
  let k = 0;
  beatXs.forEach((bx, i) => { if (bx != null && bx <= x) k = i; });
  return k;
}

/** The beat playing at `seconds`. `beatTimes` is each played measure's tap times (`measureBeatTimes`). */
export function beatPointAt(seconds: number, beatTimes: readonly number[][]): BeatPoint {
  const played = currentMeasureIndex(seconds, beatTimes.map((m) => m[0]));
  let beat = 0;
  (beatTimes[played] ?? []).forEach((t, i) => { if (t <= seconds) beat = i; });
  return { played, beat };
}

function clampPoint(pt: BeatPoint, beatTimes: readonly number[][]): BeatPoint {
  const played = Math.max(0, Math.min(pt.played, beatTimes.length - 1));
  const beat = Math.max(0, Math.min(pt.beat, beatTimes[played].length - 1));
  return { played, beat };
}

/** When a beat starts, in seconds (null without timing). */
export function beatStart(pt: BeatPoint, beatTimes: readonly number[][]): number | null {
  if (beatTimes.length === 0) return null;
  const c = clampPoint(pt, beatTimes);
  return beatTimes[c.played][c.beat];
}

/**
 * The A/B loop a click on one beat (the in point) and a shift-click on
 * another make: from the earlier beat's start to the later beat's end, in
 * seconds, either order. A measure with only its downbeat tapped is one
 * beat, so the loop takes all of it. `songEnd` caps the last beat, which
 * has no next tap to end it.
 */
export function beatLoop(
  from: BeatPoint,
  to: BeatPoint,
  beatTimes: readonly number[][],
  songEnd: number,
): { a: number; b: number } | null {
  if (beatTimes.length === 0) return null;
  let lo = clampPoint(from, beatTimes);
  let hi = clampPoint(to, beatTimes);
  if (hi.played < lo.played || (hi.played === lo.played && hi.beat < lo.beat)) [lo, hi] = [hi, lo];
  const a = beatTimes[lo.played][lo.beat];
  const beats = beatTimes[hi.played];
  let b = beats[hi.beat + 1] ?? beatTimes[hi.played + 1]?.[0];
  if (b === undefined) {
    // The very last beat: as long as the measure's average beat, or as long
    // as the measure before with only a downbeat.
    const n = beats.length;
    if (n > 1) b = beats[n - 1] + (beats[n - 1] - beats[0]) / (n - 1);
    else if (hi.played > 0) b = beats[0] + (beats[0] - beatTimes[hi.played - 1][0]);
    else b = songEnd;
  }
  if (songEnd > a) b = Math.min(b, songEnd);
  return b > a ? { a, b } : null;
}
