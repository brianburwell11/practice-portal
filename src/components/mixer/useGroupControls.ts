import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import type { StemGroupConfig, StemConfig } from '../../audio/types';

/**
 * A group's mixer state and handlers, shared by the mobile card and the
 * desktop strip. Returns null until the group's mixer state exists.
 */
export function useGroupControls(groupConfig: StemGroupConfig, stemConfigs: StemConfig[]) {
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

  const setVolume = (v: number) => {
    setGroupVolume(groupConfig.id, v);
    engine.setGroupVolume(groupConfig.id, v);
  };

  // Group M/S fan out to the member stems instead of toggling a group
  // flag: the user can flip individual tracks and the group button reflects
  // membership. Clicking only *adds* to the set when every member is
  // currently inactive; any partial or full active state releases the
  // whole stack.
  const toggleMute = () => {
    const target = mutedCount === 0;
    for (const stem of stemConfigs) {
      setStemMuted(stem.id, target);
      engine.setStemMuted(stem.id, target);
    }
  };

  const toggleSolo = () => {
    const target = soloedCount === 0;
    for (const stem of stemConfigs) {
      setStemSoloed(stem.id, target);
      engine.setStemSoloed(stem.id, target);
    }
  };

  return {
    groupState, globalMuteActive, globalSoloActive, mutedCount, soloedCount,
    allMuted: total > 0 && mutedCount === total,
    allSoloed: total > 0 && soloedCount === total,
    setVolume, toggleMute, toggleSolo,
    toggleExpanded: () => toggleGroupExpanded(groupConfig.id),
  };
}
