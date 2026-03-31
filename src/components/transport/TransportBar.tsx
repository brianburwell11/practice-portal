import { useEffect } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { WaveformTimeline } from './WaveformTimeline';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TransportBar() {
  const engine = useAudioEngine();
  const { playing, position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);

  const disabled = !selectedSong;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !disabled) {
        e.preventDefault();
        playing ? engine.pause() : engine.play();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, playing, disabled]);

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-700">
      {/* Transport buttons */}
      <div className="flex items-center gap-2">
        <button
          className="w-10 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
          disabled={disabled}
          onClick={() => engine.stop()}
          title="Stop"
        >
          &#9632;
        </button>
        <button
          className="w-10 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-lg transition-colors"
          disabled={disabled}
          onClick={() => (playing ? engine.pause() : engine.play())}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>
      </div>

      {/* Position display */}
      <div className="font-mono text-sm text-gray-300 min-w-[100px]">
        {formatTime(position)} / {formatTime(duration)}
      </div>

      {/* Waveform timeline */}
      <WaveformTimeline />

      {/* Song info */}
      {selectedSong && (
        <div className="text-sm text-gray-400 shrink-0">
          <span className="text-gray-200">{selectedSong.title}</span>
          <span className="mx-1">—</span>
          <span>{selectedSong.artist}</span>
          {selectedSong.key && (
            <span className="ml-2 px-1.5 py-0.5 bg-gray-700 rounded text-xs">
              {selectedSong.key}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
