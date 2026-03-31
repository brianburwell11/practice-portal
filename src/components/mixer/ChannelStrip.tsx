import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import type { StemConfig } from '../../audio/types';

interface ChannelStripProps {
  stemConfig: StemConfig;
}

export function ChannelStrip({ stemConfig }: ChannelStripProps) {
  const engine = useAudioEngine();
  const stemState = useMixerStore((s) => s.stems[stemConfig.id]);
  const { setStemVolume, setStemPan, setStemMuted, setStemSoloed } = useMixerStore();

  if (!stemState) return null;

  const handleVolume = (v: number) => {
    setStemVolume(stemConfig.id, v);
    engine.setStemVolume(stemConfig.id, v);
  };

  const handlePan = (v: number) => {
    setStemPan(stemConfig.id, v);
    engine.setStemPan(stemConfig.id, v);
  };

  const handleMute = () => {
    const newMuted = !stemState.muted;
    setStemMuted(stemConfig.id, newMuted);
    engine.setStemMuted(stemConfig.id, newMuted);
  };

  const handleSolo = () => {
    const newSoloed = !stemState.soloed;
    setStemSoloed(stemConfig.id, newSoloed);
    engine.setStemSoloed(stemConfig.id, newSoloed);
  };

  return (
    <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[140px]">
      {/* Label with color indicator */}
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stemConfig.color }} />
        <span className="text-sm font-medium text-gray-200 truncate">{stemConfig.label}</span>
      </div>

      {/* Volume slider */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-7">Vol</label>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={stemState.volume}
          onChange={(e) => handleVolume(parseFloat(e.target.value))}
          className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
        />
        <span className="text-xs text-gray-500 w-8 text-right font-mono">
          {Math.round(stemState.volume * 100)}
        </span>
      </div>

      {/* Pan slider */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-7">Pan</label>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={stemState.pan}
          onChange={(e) => handlePan(parseFloat(e.target.value))}
          className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
        />
        <span className="text-xs text-gray-500 w-8 text-right font-mono">
          {stemState.pan === 0 ? 'C' : stemState.pan < 0 ? `L${Math.round(Math.abs(stemState.pan) * 100)}` : `R${Math.round(stemState.pan * 100)}`}
        </span>
      </div>

      {/* Mute / Solo buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleMute}
          className={`flex-1 text-xs py-1 rounded font-medium transition-colors ${
            stemState.muted
              ? 'bg-red-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          M
        </button>
        <button
          onClick={handleSolo}
          className={`flex-1 text-xs py-1 rounded font-medium transition-colors ${
            stemState.soloed
              ? 'bg-yellow-500 text-gray-900'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          S
        </button>
      </div>
    </div>
  );
}
