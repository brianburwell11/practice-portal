import type { TempoMapEntry, MarkerConfig, TimeSignatureEntry, TapMapEntry } from './types';

/** Convert a beat position to seconds using the tempo map. */
export function beatToSeconds(beat: number, tempoMap: TempoMapEntry[], beatOffset = 0): number {
  let seconds = 0;

  for (let i = 0; i < tempoMap.length; i++) {
    const entry = tempoMap[i];
    const nextBeat = i + 1 < tempoMap.length ? tempoMap[i + 1].beat : beat;
    const segmentEnd = Math.min(nextBeat, beat);

    if (segmentEnd <= entry.beat) break;

    const beatsInSegment = segmentEnd - entry.beat;
    seconds += (beatsInSegment / entry.bpm) * 60;

    if (segmentEnd >= beat) break;
  }

  return seconds + beatOffset;
}

/** Convert all markers from beat positions to seconds. */
export function markersToSeconds(
  markers: MarkerConfig[],
  tempoMap: TempoMapEntry[],
  beatOffset = 0,
): Array<{ name: string; seconds: number; color: string }> {
  return markers.map((m) => ({
    name: m.name,
    seconds: beatToSeconds(m.beat, tempoMap, beatOffset),
    color: m.color,
  }));
}

/** Convert a seconds position to a beat using the tempo map (inverse of beatToSeconds). */
export function secondsToBeat(seconds: number, tempoMap: TempoMapEntry[], beatOffset = 0): number {
  let remaining = seconds - beatOffset;

  if (remaining <= 0) return 0;

  for (let i = 0; i < tempoMap.length; i++) {
    const entry = tempoMap[i];
    const nextBeat = i + 1 < tempoMap.length ? tempoMap[i + 1].beat : Infinity;
    const segmentBeats = nextBeat - entry.beat;
    const segmentSeconds = (segmentBeats / entry.bpm) * 60;

    if (remaining <= segmentSeconds || nextBeat === Infinity) {
      return entry.beat + (remaining / 60) * entry.bpm;
    }

    remaining -= segmentSeconds;
  }

  // Fallback: use last tempo entry
  const last = tempoMap[tempoMap.length - 1];
  return last.beat + (remaining / 60) * last.bpm;
}

/** Snap a beat value to the nearest integer beat. */
export function snapToNearestBeat(beat: number): number {
  return Math.round(beat);
}

export interface BeatGridLine {
  beat: number;
  seconds: number;
  isBarLine: boolean;
}

/**
 * Extract the audio-time of every measure/section onset from a tapMap.
 * The scrolling-score feature uses this as the canonical "barline time"
 * sequence — beat-level tap jitter is deliberately ignored.
 */
export function measureStartTimes(tapMap: TapMapEntry[] | undefined): number[] {
  if (!tapMap) return [];
  return tapMap
    .filter((t) => t.type === 'measure' || t.type === 'section')
    .map((t) => t.time);
}

/**
 * Given audio time, return the 0-based index of the current measure by
 * finding the largest `measureStartTime <= seconds`. Clamps to 0 during
 * pre-roll / count-in before the first measure tap, and to the last
 * measure after the final one.
 */
export function currentMeasureIndex(seconds: number, measureTimes: number[]): number {
  if (measureTimes.length === 0) return 0;
  if (seconds < measureTimes[0]) return 0;
  if (seconds >= measureTimes[measureTimes.length - 1]) return measureTimes.length - 1;
  let lo = 0;
  let hi = measureTimes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (measureTimes[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Generate a grid of beat lines with bar line indicators. */
export function generateBeatGrid(
  tempoMap: TempoMapEntry[],
  timeSignatureMap: TimeSignatureEntry[],
  beatOffset: number,
  durationSeconds: number,
): BeatGridLine[] {
  const maxBeat = secondsToBeat(durationSeconds, tempoMap, beatOffset);
  const grid: BeatGridLine[] = [];

  for (let beat = 0; beat <= maxBeat; beat++) {
    const seconds = beatToSeconds(beat, tempoMap, beatOffset);

    if (seconds < 0 || seconds > durationSeconds) continue;

    // Determine active time signature for this beat
    let activeTsEntry = timeSignatureMap[0];
    for (const tsEntry of timeSignatureMap) {
      if (tsEntry.beat <= beat) {
        activeTsEntry = tsEntry;
      } else {
        break;
      }
    }

    const isBarLine = (beat - activeTsEntry.beat) % activeTsEntry.numerator === 0;

    grid.push({ beat, seconds, isBarLine });
  }

  return grid;
}
