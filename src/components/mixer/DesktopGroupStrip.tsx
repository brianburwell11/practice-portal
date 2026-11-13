import type { StemGroupConfig, StemConfig } from '../../audio/types';
import { formatDb, parseDb } from '../../audio/db';
import { useGroupControls } from './useGroupControls';
import { GroupMuteSolo } from './MuteSoloButtons';
import { MAX_GAIN, VerticalFader } from './VerticalFader';
import { EditableReadout } from './EditableReadout';
import {
  DesktopChannelStrip, NameBlock, STRIP_MS_BUTTON, StripFrame,
} from './DesktopChannelStrip';
import { textOn } from './textOn';
import { useFaderGang } from './useFaderGang';
import { groupKey } from '../../store/faderSelectionStore';

interface DesktopGroupStripProps {
  groupConfig: StemGroupConfig;
  stemConfigs: StemConfig[];
}

/**
 * A group's vertical strip (desktop), laid out like a Logic track stack.
 * The band under its name, in the stack's color, has the `>` that folds the
 * member strips out to the right; while open the band runs across them and
 * carries each member's name.
 */
export function DesktopGroupStrip({ groupConfig, stemConfigs }: DesktopGroupStripProps) {
  const g = useGroupControls(groupConfig, stemConfigs);
  const gang = useFaderGang(groupKey(groupConfig.id), (v) => g?.setVolume(v));
  if (!g) return null;
  const { groupState } = g;
  const { label, color } = groupConfig;
  const open = groupState.expanded;

  return (
    <div
      role="group"
      aria-label={`${label} track stack`}
      className="flex h-full shrink-0 gap-px rounded-md overflow-hidden"
    >
      <StripFrame
        className="w-[76px] bg-gray-800"
        bandColor={color}
        selected={gang.selected}
        events={gang.events}
        fader={(
          <VerticalFader
            value={groupState.volume}
            onChange={gang.setVolume}
            resetValue={groupConfig.defaultVolume ?? 1}
            onReset={() => gang.reset(groupConfig.defaultVolume ?? 1)}
            color={color}
            label={`${label} volume`}
          />
        )}
        dbReadout={(
          <EditableReadout
            text={formatDb(groupState.volume)}
            parse={(t) => parseDb(t, MAX_GAIN)}
            onCommit={gang.setVolume}
            label={`${label} volume in dB`}
          />
        )}
        buttons={(
          <GroupMuteSolo
            label={label}
            mutedCount={g.mutedCount}
            soloedCount={g.soloedCount}
            allMuted={g.allMuted}
            allSoloed={g.allSoloed}
            globalMuteActive={g.globalMuteActive}
            globalSoloActive={g.globalSoloActive}
            onMute={g.toggleMute}
            onSolo={g.toggleSolo}
            buttonClassName={STRIP_MS_BUTTON}
          />
        )}
        name={<NameBlock label={label} />}
        nameStyle={{ backgroundColor: color, color: textOn(color) }}
        stackRow={(
          <button
            onClick={g.toggleExpanded}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={open}
            title={open ? 'Fold tracks in' : 'Show tracks'}
            className="w-full h-full flex items-center justify-center gap-1 px-1 hover:bg-black/15 transition-colors"
          >
            {!open && (
              <span
                className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium leading-none"
                title={`Track stack, ${stemConfigs.length} tracks`}
              >
                <StackIcon />
                {stemConfigs.length}
              </span>
            )}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}
      />

      {open && stemConfigs.map((stem) => (
        <DesktopChannelStrip key={stem.id} stemConfig={stem} stackColor={color} />
      ))}
    </div>
  );
}

/** Three stacked layers, the track stack mark. */
function StackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden>
      <path d="M12 3 2 8l10 5 10-5-10-5Z" />
      <path d="m2 13 10 5 10-5" />
      <path d="m2 18 10 5 10-5" />
    </svg>
  );
}
