import { ChannelStrip, SliderRowSpacer } from './ChannelStrip';
import { TouchSlider } from '../ui/TouchSlider';
import type { StemGroupConfig, StemConfig } from '../../audio/types';
import { useGroupControls } from './useGroupControls';
import { GroupMuteSolo } from './MuteSoloButtons';

interface GroupStripProps {
  groupConfig: StemGroupConfig;
  stemConfigs: StemConfig[];
}

/** A group's horizontal mixer card (phones). Desktop uses `DesktopGroupStrip`. */
export function GroupStrip({ groupConfig, stemConfigs }: GroupStripProps) {
  const g = useGroupControls(groupConfig, stemConfigs);
  if (!g) return null;
  const { groupState } = g;

  return (
    <div className="flex flex-col">
      {/* Group header */}
      <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[230px] border border-gray-600">
        {/* Label with expand toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={g.toggleExpanded}
            aria-label={`${groupState.expanded ? 'Collapse' : 'Expand'} ${groupConfig.label}`}
            aria-expanded={groupState.expanded}
            className="text-gray-400 hover:text-gray-200 transition-colors text-xs w-4"
          >
            {groupState.expanded ? '▼' : '▶'}
          </button>
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: groupConfig.color }} />
          <span className="text-sm font-semibold text-gray-200 truncate">{groupConfig.label}</span>
          <span className="text-xs text-gray-500 ml-auto">{stemConfigs.length}</span>
        </div>

        {/* Group volume slider */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-7">Vol</label>
          <TouchSlider min={0} max={1.5} step={0.01} value={groupState.volume} onChange={g.setVolume} label={`${groupConfig.label} volume`} className="flex-1" />
          <span className="text-xs text-gray-500 w-8 text-right font-mono">
            {Math.round(groupState.volume * 100)}
          </span>
        </div>

        {/* No pan for a group; keep the row so it matches a mono stem's height. */}
        <SliderRowSpacer />

        <div className="flex gap-2">
          <GroupMuteSolo
            label={groupConfig.label}
            mutedCount={g.mutedCount}
            soloedCount={g.soloedCount}
            allMuted={g.allMuted}
            allSoloed={g.allSoloed}
            globalMuteActive={g.globalMuteActive}
            globalSoloActive={g.globalSoloActive}
            onMute={g.toggleMute}
            onSolo={g.toggleSolo}
            buttonClassName="flex-1 text-xs py-1 min-h-[44px] md:min-h-0"
          />
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
