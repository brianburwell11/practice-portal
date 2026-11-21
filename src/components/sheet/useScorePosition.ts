import { useMemo } from 'react';
import { measureStartTimes } from '../../audio/tempoUtils';
import type { TapMapEntry } from '../../audio/types';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { measureBeatTimes } from './loopSpans';
import { PAST_END, scorePositionAt, type ScorePosition } from './scorePosition';

/**
 * The current song's measure downbeat times (from its tapMap) and the score
 * position at the current transport time. Re-renders on every position update.
 */
export function useScorePosition(unfolded: readonly UnfoldedStep[], writtenCount: number, tapMapOverride?: TapMapEntry[]): {
  measureTimes: number[];
  /** Each played measure's tap times: its downbeat, then its beats. */
  beatTimes: number[][];
  scorePosition: ScorePosition | typeof PAST_END | null;
} {
  const songTapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const tapMap = tapMapOverride ?? songTapMap;
  const position = useTransportStore((s) => s.position);
  const measureTimes = useMemo(() => measureStartTimes(tapMap), [tapMap]);
  const beatTimes = useMemo(() => measureBeatTimes(tapMap), [tapMap]);
  // With a draft beat map (the beat map editor), past the last tapped
  // downbeat the cursor waits there for the next measure tap instead of
  // sliding on into a measure that isn't tapped yet.
  const holdAtLast = tapMapOverride !== undefined;
  const scorePosition = useMemo(() => {
    const pos = scorePositionAt(position, measureTimes, unfolded, writtenCount);
    if (holdAtLast && pos && pos !== PAST_END && pos.playedIndex === measureTimes.length - 1) {
      return { ...pos, fraction: 0 };
    }
    return pos;
  }, [position, measureTimes, unfolded, writtenCount, holdAtLast]);
  return { measureTimes, beatTimes, scorePosition };
}
