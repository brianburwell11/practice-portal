import { useMemo } from 'react';
import { measureStartTimes } from '../../audio/tempoUtils';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { scorePositionAt, type PAST_END, type ScorePosition } from './scorePosition';

/**
 * The current song's measure downbeat times (from its tapMap) and the score
 * position at the current transport time. Re-renders on every position update.
 */
export function useScorePosition(unfolded: readonly UnfoldedStep[], writtenCount: number): {
  measureTimes: number[];
  scorePosition: ScorePosition | typeof PAST_END | null;
} {
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const position = useTransportStore((s) => s.position);
  const measureTimes = useMemo(() => measureStartTimes(tapMap), [tapMap]);
  const scorePosition = useMemo(
    () => scorePositionAt(position, measureTimes, unfolded, writtenCount),
    [position, measureTimes, unfolded, writtenCount],
  );
  return { measureTimes, scorePosition };
}
