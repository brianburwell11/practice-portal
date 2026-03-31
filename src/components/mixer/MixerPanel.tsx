import { useMemo } from 'react';
import { useSongStore } from '../../store/songStore';
import { ChannelStrip } from './ChannelStrip';
import { GroupStrip } from './GroupStrip';

export function MixerPanel() {
  const selectedSong = useSongStore((s) => s.selectedSong);

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
