import { useMemo } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { ChannelStrip } from './ChannelStrip';
import { GroupStrip } from './GroupStrip';

export function MixerPanel() {
  const engine = useAudioEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const { masterVolume, setMasterVolume } = useMixerStore();

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

  const handleMasterVolume = (v: number) => {
    setMasterVolume(v);
    engine.setMasterVolume(v);
  };

  return (
    <div className="flex-1 p-4 overflow-auto">
      {/* Master volume */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-gray-800/50 rounded-lg">
        <label className="text-sm text-gray-400 font-medium">Master</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={masterVolume}
          onChange={(e) => handleMasterVolume(parseFloat(e.target.value))}
          className="flex-1 h-2 accent-blue-500 cursor-pointer"
        />
        <span className="text-sm text-gray-400 font-mono w-10 text-right">
          {Math.round(masterVolume * 100)}
        </span>
      </div>

      {/* Groups and ungrouped stems */}
      <div className="flex gap-3 flex-wrap items-start">
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
