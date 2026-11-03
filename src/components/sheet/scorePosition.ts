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
