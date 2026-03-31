import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function EditorTransportControls() {
  const engine = useAudioEngine();
  const { playing, position, duration } = useTransportStore();

  return (
    <div className="flex items-center gap-3">
      <button
        className="w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 flex items-center justify-center text-base transition-colors"
        onClick={() => (playing ? engine.pause() : engine.play())}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? '\u23F8' : '\u25B6'}
      </button>
      <span className="font-mono text-sm text-gray-300 min-w-[80px]">
        {formatTime(position)} / {formatTime(duration)}
      </span>
    </div>
  );
}
