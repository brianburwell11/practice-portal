import { useMemo } from 'react';
import type { UnfoldedStep } from '../../audio/unfoldRepeats';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { loopSpans, measureBeatTimes, type LoopSpan } from './loopSpans';

/** The written measures the current A/B loop covers (none while it's off or unfinished). */
export function useLoopSpans(unfolded: readonly UnfoldedStep[], writtenCount: number): LoopSpan[] {
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const loopA = useTransportStore((s) => s.loopA);
  const loopB = useTransportStore((s) => s.loopB);
  const enabled = useTransportStore((s) => s.loopEnabled);
  const beatTimes = useMemo(() => measureBeatTimes(tapMap), [tapMap]);
  return useMemo(
    () => (enabled ? loopSpans(loopA, loopB, beatTimes, unfolded, writtenCount) : []),
    [enabled, loopA, loopB, beatTimes, unfolded, writtenCount],
  );
}
