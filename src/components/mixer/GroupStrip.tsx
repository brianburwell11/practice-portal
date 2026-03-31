import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { ChannelStrip } from './ChannelStrip';
import type { StemGroupConfig, StemConfig } from '../../audio/types';

interface GroupStripProps {
  groupConfig: StemGroupConfig;
  stemConfigs: StemConfig[];
}

export function GroupStrip({ groupConfig, stemConfigs }: GroupStripProps) {
  const engine = useAudioEngine();
  const groupState = useMixerStore((s) => s.groups[groupConfig.id]);
  const { setGroupVolume, setGroupMuted, setGroupSoloed, toggleGroupExpanded } = useMixerStore();

  if (!groupState) return null;

  const handleVolume = (v: number) => {
    setGroupVolume(groupConfig.id, v);
    engine.setGroupVolume(groupConfig.id, v);
  };

  const handleMute = () => {
    const newMuted = !groupState.muted;
    setGroupMuted(groupConfig.id, newMuted);
    engine.setGroupMuted(groupConfig.id, newMuted);
  };

  const handleSolo = () => {
    const newSoloed = !groupState.soloed;
    setGroupSoloed(groupConfig.id, newSoloed);
    engine.setGroupSoloed(groupConfig.id, newSoloed);
  };

  return (
    <div className="flex flex-col">
      {/* Group header */}
      <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[140px] border border-gray-600">
        {/* Label with expand toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleGroupExpanded(groupConfig.id)}
            className="text-gray-400 hover:text-gray-200 transition-colors text-xs w-4"
          >
            {groupState.expanded ? '\u25BC' : '\u25B6'}
          </button>
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: groupConfig.color }} />
          <span className="text-sm font-semibold text-gray-200 truncate">{groupConfig.label}</span>
          <span className="text-xs text-gray-500 ml-auto">{stemConfigs.length}</span>
        </div>

        {/* Group volume slider */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-7">Vol</label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={groupState.volume}
            onChange={(e) => handleVolume(parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
          />
          <span className="text-xs text-gray-500 w-8 text-right font-mono">
            {Math.round(groupState.volume * 100)}
          </span>
        </div>

        {/* Mute / Solo buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleMute}
            className={`flex-1 text-xs py-1 rounded font-medium transition-colors ${
              groupState.muted
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            M
          </button>
          <button
            onClick={handleSolo}
            className={`flex-1 text-xs py-1 rounded font-medium transition-colors ${
              groupState.soloed
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            S
          </button>
        </div>
      </div>

      {/* Expanded child stems */}
      {groupState.expanded && (
        <div className="flex flex-col gap-1.5 pl-4 pt-1.5 border-l-2 border-gray-600 ml-3">
          {stemConfigs.map((stem) => (
            <ChannelStrip key={stem.id} stemConfig={stem} />
          ))}
        </div>
      )}
    </div>
  );
}
