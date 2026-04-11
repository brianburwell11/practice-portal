import { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { ChannelStrip } from './ChannelStrip';
import { GroupStrip } from './GroupStrip';

export function MixerPanel() {
  const engine = useAudioEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const stems = useMixerStore((s) => s.stems);
  const globalSoloActive = useMixerStore((s) => s.globalSoloActive);
  const globalMuteActive = useMixerStore((s) => s.globalMuteActive);
  const toggleGlobalSolo = useMixerStore((s) => s.toggleGlobalSolo);
  const toggleGlobalMute = useMixerStore((s) => s.toggleGlobalMute);
  const clearSoloGroup = useMixerStore((s) => s.clearSoloGroup);
  const clearMuteGroup = useMixerStore((s) => s.clearMuteGroup);

  const anySoloed = Object.values(stems).some((s) => s.soloed);
  const anyMuted = Object.values(stems).some((s) => s.muted);

  const handleGlobalSolo = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click: clear the solo group entirely
      for (const [id, state] of Object.entries(stems)) {
        if (state.soloed) engine.setStemSoloed(id, false);
      }
      clearSoloGroup();
      return;
    }
    const newActive = !globalSoloActive;
    toggleGlobalSolo();
    for (const [id, state] of Object.entries(stems)) {
      if (state.soloed) {
        engine.setStemSoloed(id, newActive);
      }
    }
  };

  const handleGlobalMute = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      for (const [id, state] of Object.entries(stems)) {
        if (state.muted) engine.setStemMuted(id, false);
      }
      clearMuteGroup();
      return;
    }
    const newActive = !globalMuteActive;
    toggleGlobalMute();
    for (const [id, state] of Object.entries(stems)) {
      if (state.muted) {
        engine.setStemMuted(id, newActive);
      }
    }
  };

  // Compute which stems are grouped vs ungrouped
  const { ungroupedStems } = useMemo(() => {
    if (!selectedSong) return { ungroupedStems: [] };
    const grouped = new Set<string>();
    for (const group of selectedSong.groups ?? []) {
      for (const id of group.stemIds) {
        grouped.add(id);
      }
    }
    const ungrouped = selectedSong.stems.filter((s) => !grouped.has(s.id));
    return { ungroupedStems: ungrouped };
  }, [selectedSong]);

  if (!selectedSong) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select a song to get started
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 overflow-auto">
      {/* Global mute/solo */}
      <div className="flex gap-2 mb-3 md:w-[230px]">
        <button
          onClick={handleGlobalMute}
          className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
            globalMuteActive && anyMuted
              ? 'bg-red-600 text-white border-red-600'
              : anyMuted
                ? 'bg-gray-700 text-gray-400 border-red-600'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border-transparent'
          }`}
        >
          M
        </button>
        <button
          onClick={handleGlobalSolo}
          className={`flex-1 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
            globalSoloActive && anySoloed
              ? 'bg-yellow-500 text-gray-900 border-yellow-500'
              : anySoloed
                ? 'bg-gray-700 text-gray-400 border-yellow-500'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 border-transparent'
          }`}
        >
          S
        </button>
      </div>

      {/* Groups and ungrouped stems */}
      <div className="flex flex-col md:flex-row gap-3 md:flex-wrap md:items-start">
        {(selectedSong.groups ?? []).map((group) => {
          const stemConfigs = group.stemIds
            .map((id) => selectedSong.stems.find((s) => s.id === id))
            .filter((s) => s != null);
          return <GroupStrip key={group.id} groupConfig={group} stemConfigs={stemConfigs} />;
        })}
        {ungroupedStems.map((stem) => (
          <ChannelStrip key={stem.id} stemConfig={stem} />
        ))}
      </div>
    </div>
  );
}
