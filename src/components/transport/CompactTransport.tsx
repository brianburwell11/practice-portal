import { measureBeatAt } from '../../audio/tempoUtils';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { formatTime } from '../../utils/formatTime';
import { LoopButton, PlayPauseButton, StopButton } from './TransportButtons';
import { WaveformTimeline } from './WaveformTimeline';

/**
 * A one-row transport for docking under a full-screen view: stop, play, the
 * A/B loop, a short waveform (seek, drag a loop on it, as usual), and where
 * playback is. Touch layouts get bigger buttons and long-press to stop.
 */
export function CompactTransport({ touch = false }: { touch?: boolean }) {
  const position = useTransportStore((s) => s.position);
  const duration = useTransportStore((s) => s.duration);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const mb = measureBeatAt(tapMap, position);
  const size = touch ? 'lg' : 'sm';

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {!touch && <StopButton size={size} />}
      <PlayPauseButton size={size} longPressStops={touch} />
      <LoopButton size={size} verb={touch ? 'Tap' : 'Click'} />
      <div className="min-w-0 flex-1">
        <WaveformTimeline compact />
      </div>
      <div className="shrink-0 text-right font-mono text-xs leading-tight text-gray-300">
        <div>{formatTime(position)}<span className="text-gray-500"> / {formatTime(duration)}</span></div>
        {mb && <div className="text-gray-500">{mb.measure}<span className="mx-0.5 text-gray-600">|</span>{mb.beat}</div>}
      </div>
    </div>
  );
}
