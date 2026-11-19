import { useEffect, useState, type RefObject } from 'react';
import type { StemConfig, StemGroupConfig } from '../../audio/types';
import { TouchSlider } from '../ui/TouchSlider';
import { GroupMuteSolo, StemMuteSolo } from './MuteSoloButtons';
import { textOn } from './textOn';
import { useGroupControls } from './useGroupControls';
import { useStemControls } from './useStemControls';
import type { MixerOrderItem } from '../../audio/mixerOrder';

const BAR_MS_BUTTON = 'w-6 h-6 text-[11px] leading-none shrink-0';
const BAR_ITEM = 'flex items-center gap-1.5 shrink-0 rounded-md bg-gray-800 pl-1 pr-2 py-1';

/** The stem's name on its own color, like the strips' name blocks. */
function Name({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="max-w-[7rem] truncate rounded-sm px-1.5 text-[11px] font-medium leading-5"
      style={{ backgroundColor: color, color: textOn(color) }}
      title={label}
    >
      {label}
    </span>
  );
}

function StemItem({ stemConfig }: { stemConfig: StemConfig }) {
  const c = useStemControls(stemConfig);
  if (!c) return null;
  return (
    <div className={BAR_ITEM}>
      <Name label={stemConfig.label} color={stemConfig.color} />
      <StemMuteSolo
        label={stemConfig.label}
        muted={c.stemState.muted}
        soloed={c.stemState.soloed}
        globalMuteActive={c.globalMuteActive}
        globalSoloActive={c.globalSoloActive}
        onMute={c.toggleMute}
        onSolo={c.toggleSolo}
        buttonClassName={BAR_MS_BUTTON}
      />
      <TouchSlider
        min={0}
        max={1.5}
        step={0.01}
        value={c.stemState.volume}
        onChange={c.setVolume}
        onDoubleClick={() => c.setVolume(stemConfig.defaultVolume)}
        label={`${stemConfig.label} volume`}
        className="w-20"
      />
    </div>
  );
}

function GroupItem({ groupConfig, stemConfigs }: { groupConfig: StemGroupConfig; stemConfigs: StemConfig[] }) {
  const g = useGroupControls(groupConfig, stemConfigs);
  if (!g) return null;
  return (
    <div className={BAR_ITEM}>
      <Name label={groupConfig.label} color={groupConfig.color} />
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
        buttonClassName={BAR_MS_BUTTON}
      />
      <TouchSlider
        min={0}
        max={1.5}
        step={0.01}
        value={g.groupState.volume}
        onChange={g.setVolume}
        onDoubleClick={() => g.setVolume(groupConfig.defaultVolume ?? 1)}
        label={`${groupConfig.label} volume`}
        className="w-20"
      />
    </div>
  );
}

/**
 * Desktop: while the full mixer is scrolled out of view (under a tall
 * score), a slim bar pinned to the bottom of the page keeps each stem's
 * mute, solo and volume in reach. "Mixer" scrolls down to the full strips;
 * once they're on screen the bar steps aside.
 */
export function MixerBar({
  items,
  stems,
  panelRef,
}: {
  items: MixerOrderItem[];
  stems: StemConfig[];
  panelRef: RefObject<HTMLDivElement | null>;
}) {
  const [panelInView, setPanelInView] = useState(true);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // "In view" once the strips' top rows are on screen, not just their top edge.
    const io = new IntersectionObserver(
      ([entry]) => setPanelInView(entry.isIntersecting),
      { rootMargin: '0px 0px -160px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [panelRef]);

  if (panelInView) return null;

  return (
    <div
      role="region"
      aria-label="Quick mixer"
      className="mixer-surfaces hidden md:flex sticky bottom-0 z-20 items-center gap-2 px-3 py-1.5 border-t shadow-[0_-4px_12px_rgb(0_0_0/0.25)]"
      style={{
        backgroundColor: 'var(--band-bg, var(--color-page))',
        borderColor: 'color-mix(in srgb, var(--band-accent, #374151) 40%, transparent)',
      }}
    >
      <div className="flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto">
        {items.map((item) => item.kind === 'group' ? (
          <GroupItem
            key={item.id}
            groupConfig={item.group}
            stemConfigs={item.group.stemIds
              .map((id) => stems.find((s) => s.id === id))
              .filter((s) => s != null)}
          />
        ) : (
          <StemItem key={item.id} stemConfig={item.stem} />
        ))}
      </div>
      <button
        onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
        className="shrink-0 inline-flex items-center gap-1 rounded-md bg-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-200 hover:text-gray-50 hover:shadow-[inset_0_0_0_1px_var(--band-ink,#f3f4f6)] transition-colors"
        title="Show the full mixer"
      >
        Mixer
        <svg aria-hidden="true" viewBox="0 0 10 6" className="w-2.5 h-1.5">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
