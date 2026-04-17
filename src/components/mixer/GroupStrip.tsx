import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { ChannelStrip } from './ChannelStrip';
import { TouchSlider } from '../ui/TouchSlider';
import type { StemGroupConfig, StemConfig } from '../../audio/types';

interface GroupStripProps {
  groupConfig: StemGroupConfig;
  stemConfigs: StemConfig[];
}

export function GroupStrip({ groupConfig, stemConfigs }: GroupStripProps) {
  const engine = useAudioEngine();
  const groupState = useMixerStore((s) => s.groups[groupConfig.id]);
  const stems = useMixerStore((s) => s.stems);
  const globalMuteActive = useMixerStore((s) => s.globalMuteActive);
  const globalSoloActive = useMixerStore((s) => s.globalSoloActive);
  const { setGroupVolume, setStemMuted, setStemSoloed, toggleGroupExpanded } = useMixerStore();

  if (!groupState) return null;

  const mutedCount = stemConfigs.reduce((n, s) => n + (stems[s.id]?.muted ? 1 : 0), 0);
  const soloedCount = stemConfigs.reduce((n, s) => n + (stems[s.id]?.soloed ? 1 : 0), 0);
  const total = stemConfigs.length;
  const allMuted = total > 0 && mutedCount === total;
  const allSoloed = total > 0 && soloedCount === total;

  const handleVolume = (v: number) => {
    setGroupVolume(groupConfig.id, v);
    engine.setGroupVolume(groupConfig.id, v);
  };

  // Group M/S now fan out to the member stems instead of toggling a group
  // flag: the user can flip individual tracks and the card button reflects
  // membership. Clicking only *adds* to the set when every member is
  // currently inactive; any partial or full active state releases the
  // whole stack.
  const handleMute = () => {
    const target = mutedCount === 0;
    for (const stem of stemConfigs) {
      setStemMuted(stem.id, target);
      engine.setStemMuted(stem.id, target);
    }
  };

  const handleSolo = () => {
    const target = soloedCount === 0;
    for (const stem of stemConfigs) {
      setStemSoloed(stem.id, target);
      engine.setStemSoloed(stem.id, target);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Group header */}
      <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[230px] border border-gray-600">
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
          <TouchSlider min={0} max={1.5} step={0.01} value={groupState.volume} onChange={handleVolume} label={`${groupConfig.label} volume`} className="flex-1" />
          <span className="text-xs text-gray-500 w-8 text-right font-mono">
            {Math.round(groupState.volume * 100)}
          </span>
        </div>

        {/* Mute / Solo buttons — neutral body with a colored outline when
            members are in the mute/solo set, plus a diagonal half-fill
            (bottom-left → top-right, top half colored) when the set is
            actively suppressing audio. */}
        <div className="flex gap-2">
          <button
            onClick={handleMute}
            className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
              mutedCount > 0 ? 'border-red-600' : 'border-transparent'
            } ${
              globalMuteActive && allMuted
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 ' + (mutedCount > 0 && globalMuteActive ? 'text-white' : 'text-gray-300')
            }`}
            style={
              mutedCount > 0 && globalMuteActive && !allMuted
                ? { backgroundImage: 'linear-gradient(to bottom right, #dc2626 50%, transparent 50%)' }
                : undefined
            }
          >
            M
          </button>
          <button
            onClick={handleSolo}
            className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
              soloedCount > 0 ? 'border-yellow-500' : 'border-transparent'
            } ${
              globalSoloActive && allSoloed
                ? 'bg-yellow-500 text-gray-900'
                : 'bg-gray-700 hover:bg-gray-600 ' + (soloedCount > 0 && globalSoloActive ? 'text-white' : 'text-gray-300')
            }`}
            style={
              soloedCount > 0 && globalSoloActive && !allSoloed
                ? { backgroundImage: 'linear-gradient(to bottom right, #eab308 50%, transparent 50%)' }
                : undefined
            }
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
