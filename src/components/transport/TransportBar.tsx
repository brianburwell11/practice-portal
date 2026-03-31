import { useEffect, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { WaveformTimeline } from './WaveformTimeline';
import { TempoControl } from './TempoControl';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TransportBar() {
  const engine = useAudioEngine();
  const { playing, position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const { masterVolume, setMasterVolume } = useMixerStore();

  const disabled = !selectedSong;
  const [volEditing, setVolEditing] = useState(false);
  const [volEditValue, setVolEditValue] = useState('');

  const handleMasterVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1.5, v));
    setMasterVolume(clamped);
    engine.setMasterVolume(clamped);
  };

  const commitVolEdit = () => {
    const parsed = parseInt(volEditValue, 10);
    if (!isNaN(parsed)) {
      handleMasterVolume(parsed / 100);
    }
    setVolEditing(false);
  };

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
      {/* Playback controls cluster */}
      <div className="flex flex-col gap-1 shrink-0">
        {/* Transport buttons + timestamp */}
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
          <div className="font-mono text-sm text-gray-300 ml-1">
            {formatTime(position)} / {formatTime(duration)}
          </div>
        </div>

        {/* Volume + Speed sliders, aligned */}
        <div className="grid grid-cols-[2rem_6rem_2.5rem] gap-x-2 gap-y-0.5 items-center">
          <label className="text-xs text-gray-400 text-right">Vol</label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={masterVolume}
            onChange={(e) => handleMasterVolume(parseFloat(e.target.value))}
            onDoubleClick={() => handleMasterVolume(1.0)}
            className="w-full h-1.5 accent-blue-500 cursor-pointer"
          />
          {volEditing ? (
            <input
              type="text"
              autoFocus
              value={volEditValue}
              onChange={(e) => setVolEditValue(e.target.value)}
              onBlur={commitVolEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitVolEdit();
                if (e.key === 'Escape') setVolEditing(false);
              }}
              className="w-full text-xs text-gray-300 font-mono text-right bg-gray-700 border border-gray-500 rounded px-1 py-0.5 outline-none focus:border-blue-500"
            />
          ) : (
            <button
              onClick={() => {
                setVolEditValue(String(Math.round(masterVolume * 100)));
                setVolEditing(true);
              }}
              className="text-xs text-gray-300 font-mono text-right hover:text-white cursor-text"
            >
              {Math.round(masterVolume * 100)}%
            </button>
          )}

          <TempoControl />
        </div>
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
