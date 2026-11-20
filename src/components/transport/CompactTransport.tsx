import { MasterSliders } from './MasterSliders';
import { MeasureBeatJump, TimeJump } from './PositionJump';
import { LoopButton, PlayPauseButton, StopButton } from './TransportButtons';
import { WaveformTimeline } from './WaveformTimeline';

const INPUT = 'text-xs bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-200 font-mono';

/**
 * A one-row transport for docking under a full-screen view: stop, play, the
 * A/B loop, volume and speed (wide screens), a short waveform (seek, drag a
 * loop on it, as usual), and where playback is, which can be typed into to
 * jump. Touch layouts get bigger buttons and long-press to stop.
 */
export function CompactTransport({ touch = false }: { touch?: boolean }) {
  const size = touch ? 'lg' : 'sm';

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {!touch && <StopButton size={size} />}
      <PlayPauseButton size={size} longPressStops={touch} />
      <LoopButton size={size} verb={touch ? 'Tap' : 'Click'} />
      <div className="hidden md:block shrink-0 mx-1">
        <MasterSliders />
      </div>
      <div
        className="min-w-0 flex-1"
        data-help={touch ? 'Tap to jump. Hold, then drag, to loop a section.' : 'Click to jump. Click and drag to loop a section.'}
      >
        <WaveformTimeline compact />
      </div>
      <div
        className="shrink-0 flex flex-col items-end font-mono text-xs leading-tight text-gray-300"
        data-help="Type a time or measure|beat to jump there"
        data-help-at="left"
      >
        <TimeJump className="[&>span]:text-gray-500" inputClassName={INPUT} />
        <MeasureBeatJump className="text-gray-500" inputClassName={INPUT} />
      </div>
    </div>
  );
}
