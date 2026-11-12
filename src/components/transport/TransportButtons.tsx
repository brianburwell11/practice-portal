import { useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useLongPress } from '../../hooks/useLongPress';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { formatTime } from '../../utils/formatTime';

/** Sizing for every button in the phone transport row, so however many a
 *  song has, they share one row (48px each when there's room). */
export const PHONE_ROW_BUTTON = 'flex-1 min-w-0 max-w-12 aspect-square';

export type TransportButtonSize = 'sm' | 'md' | 'lg' | 'fluid';

const SIZE: Record<TransportButtonSize, string> = {
  sm: 'w-9 h-9 text-base',
  md: 'w-10 h-10 text-lg',
  lg: 'w-12 h-12 text-lg',
  /** Phone button row: share the row evenly, square, up to the `lg` size. */
  fluid: PHONE_ROW_BUTTON + ' text-lg',
};

const BASE = 'rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Stop: back to the start. */
export function StopButton({ size = 'md' }: { size?: TransportButtonSize }) {
  const engine = useAudioEngine();
  const disabled = !useSongStore((s) => s.selectedSong);
  return (
    <button
      className={`${BASE} ${SIZE[size]} bg-gray-700 hover:bg-gray-600`}
      disabled={disabled}
      onClick={() => engine.stop()}
      title="Stop"
      aria-label="Stop"
    >
      &#9632;
    </button>
  );
}

/** Play / pause. With `longPressStops` (touch layouts), a long press stops. */
export function PlayPauseButton({ size = 'md', longPressStops = false }: { size?: TransportButtonSize; longPressStops?: boolean }) {
  const engine = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);
  const disabled = !useSongStore((s) => s.selectedSong);
  const toggle = useCallback(() => { if (playing) engine.pause(); else engine.play(); }, [engine, playing]);
  const stop = useCallback(() => engine.stop(), [engine]);
  const longPress = useLongPress(toggle, stop);
  const handlers = longPressStops ? longPress : { onClick: toggle };
  const hint = longPressStops ? ' (long-press to stop)' : '';
  return (
    <button
      className={`${BASE} ${SIZE[size]} bg-blue-600 hover:bg-blue-500 text-accent-ink`}
      disabled={disabled}
      {...handlers}
      title={(playing ? 'Pause' : 'Play') + hint}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? '❙❙' : '▶'}
    </button>
  );
}

/**
 * The A/B loop button: the first press sets where the loop starts, the second
 * where it ends, then presses turn it on and off; a long press clears it.
 * `verb` ("Click" or "Tap") is for its label.
 */
export function LoopButton({ size = 'md', verb = 'Click' }: { size?: TransportButtonSize; verb?: string }) {
  const engine = useAudioEngine();
  const loopA = useTransportStore((s) => s.loopA);
  const loopB = useTransportStore((s) => s.loopB);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const disabled = !useSongStore((s) => s.selectedSong);

  const onTap = useCallback(() => {
    // The position at the moment of the press (not subscribed: it changes every tick).
    const position = useTransportStore.getState().position;
    if (loopA !== null && loopB !== null) engine.setLoopEnabled(!loopEnabled);
    else if (loopA !== null) engine.setLoop(loopA, position);
    else engine.setLoop(position, null);
  }, [engine, loopA, loopB, loopEnabled]);
  const onLongPress = useCallback(() => engine.clearLoop(), [engine]);
  const handlers = useLongPress(onTap, onLongPress);

  const label = loopA !== null && loopB !== null
    ? `Loop ${formatTime(loopA)} – ${formatTime(loopB)}${loopEnabled ? '' : ' (off)'}. ${verb} to turn ${loopEnabled ? 'off' : 'on'}, long-press to clear.`
    : loopA !== null
      ? `Loop starts at ${formatTime(loopA)}. ${verb} to set where it ends.`
      : 'Set where the loop starts';
  const color = loopA !== null && loopB !== null
    ? loopEnabled
      ? 'bg-yellow-500 hover:bg-yellow-400 text-black'
      : 'bg-yellow-500/40 hover:bg-yellow-500/50 text-yellow-200'
    : loopA !== null
      ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
      : 'bg-gray-700 hover:bg-gray-600 text-gray-300';

  return (
    <button
      className={`${BASE} ${SIZE[size]} ${color}`}
      disabled={disabled}
      {...handlers}
      title={label}
      aria-label={label}
      aria-pressed={loopA !== null && loopB !== null ? loopEnabled : undefined}
    >
      &#x21BB;
    </button>
  );
}
