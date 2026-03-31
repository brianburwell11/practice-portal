import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMarkerEditorStore } from '../../store/markerEditorStore';

export function TapBeatOffset() {
  const engine = useAudioEngine();
  const { beatOffset, tapBeatMode, setBeatOffset, setTapBeatMode } =
    useMarkerEditorStore();

  const handleTap = () => {
    const pos = engine.clock.currentTime;
    setBeatOffset(pos);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
          tapBeatMode
            ? 'bg-amber-500 text-gray-900 hover:bg-amber-400'
            : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
        }`}
        onClick={() => {
          if (!tapBeatMode) {
            setTapBeatMode(true);
          }
          handleTap();
        }}
        title="Click while audio plays to set beat 1 position"
      >
        Tap Beat 1
      </button>

      <label className="flex items-center gap-1.5 text-sm text-gray-400">
        <span>Offset:</span>
        <input
          type="number"
          step="0.001"
          value={beatOffset.toFixed(3)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) setBeatOffset(v);
          }}
          className="w-24 px-2 py-1 rounded bg-gray-700 text-gray-200 text-sm font-mono border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-xs">s</span>
      </label>

      <span className="text-xs text-gray-500">
        Set the time position of beat 1
      </span>
    </div>
  );
}
