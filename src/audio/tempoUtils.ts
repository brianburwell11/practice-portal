import type { TempoMapEntry, MarkerConfig } from './types';

/** Convert a beat position to seconds using the tempo map. */
export function beatToSeconds(beat: number, tempoMap: TempoMapEntry[]): number {
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

  return seconds;
}

/** Convert all markers from beat positions to seconds. */
export function markersToSeconds(
  markers: MarkerConfig[],
  tempoMap: TempoMapEntry[],
): Array<{ name: string; seconds: number; color: string }> {
  return markers.map((m) => ({
    name: m.name,
    seconds: beatToSeconds(m.beat, tempoMap),
    color: m.color,
  }));
}
