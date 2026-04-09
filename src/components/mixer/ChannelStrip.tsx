import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { TouchSlider } from '../ui/TouchSlider';
import type { StemConfig } from '../../audio/types';

interface ChannelStripProps {
  stemConfig: StemConfig;
}

export function ChannelStrip({ stemConfig }: ChannelStripProps) {
  const engine = useAudioEngine();
  const stemState = useMixerStore((s) => s.stems[stemConfig.id]);
  const { setStemVolume, setStemPan, setStemMuted, setStemSoloed, setStemStereo } = useMixerStore();
  const sourceChannels = engine.getStem(stemConfig.id)?.sourceChannels ?? 1;

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

  const handleStereoToggle = () => {
    const newStereo = !stemState.stereo;
    setStemStereo(stemConfig.id, newStereo);
    engine.setStemStereo(stemConfig.id, newStereo);
  };

  return (
    <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[230px]">
      {/* Label with color indicator and stereo toggle */}
      <div className="flex items-center gap-2">
        {sourceChannels >= 2 ? (
          <button
            onClick={handleStereoToggle}
            className="shrink-0 flex items-center gap-0.5"
            title={stemState.stereo ? 'Stereo — click for mono' : 'Mono — click for stereo'}
          >
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stemConfig.color }} />
            {stemState.stereo && (
              <div className="w-3 h-3 rounded-full -ml-1.5" style={{ backgroundColor: stemConfig.color, opacity: 0.7 }} />
            )}
          </button>
        ) : (
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stemConfig.color }} />
        )}
        <span className="text-sm font-medium text-gray-200 truncate">{stemConfig.label}</span>
      </div>

      {/* Volume slider */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-7">Vol</label>
        <TouchSlider min={0} max={1.5} step={0.01} value={stemState.volume} onChange={handleVolume} label={`${stemConfig.label} volume`} className="flex-1" />
        <span className="text-xs text-gray-500 w-8 text-right font-mono">
          {Math.round(stemState.volume * 100)}
        </span>
      </div>

      {/* Pan slider — hidden in stereo mode */}
      {!stemState.stereo && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-7">Pan</label>
          <TouchSlider min={-1} max={1} step={0.01} value={stemState.pan} onChange={handlePan} onDoubleClick={() => handlePan(0)} label={`${stemConfig.label} pan`} className="flex-1" />
          <span className="text-xs text-gray-500 w-8 text-right font-mono">
            {stemState.pan === 0 ? 'C' : stemState.pan < 0 ? `L${Math.round(Math.abs(stemState.pan) * 100)}` : `R${Math.round(stemState.pan * 100)}`}
          </span>
        </div>
      )}

      {/* Mute / Solo buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleMute}
          className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors ${
            stemState.muted
              ? 'bg-red-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          M
        </button>
        <button
          onClick={handleSolo}
          className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors ${
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
