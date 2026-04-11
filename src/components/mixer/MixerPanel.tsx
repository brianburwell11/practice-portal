import { useMemo, useCallback, useState, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useLongPress } from '../../hooks/useLongPress';
import { ChannelStrip } from './ChannelStrip';
import { GroupStrip } from './GroupStrip';

type SaveState = 'idle' | 'pending' | 'cancelled' | 'saving' | 'saved' | 'error';

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

  const handleToggleSolo = useCallback(() => {
    const newActive = !globalSoloActive;
    toggleGlobalSolo();
    for (const [id, state] of Object.entries(stems)) {
      if (state.soloed) engine.setStemSoloed(id, newActive);
    }
  }, [globalSoloActive, toggleGlobalSolo, stems, engine]);

  const handleClearSolo = useCallback(() => {
    for (const [id, state] of Object.entries(stems)) {
      if (state.soloed) engine.setStemSoloed(id, false);
    }
    clearSoloGroup();
  }, [stems, engine, clearSoloGroup]);

  const handleToggleMute = useCallback(() => {
    const newActive = !globalMuteActive;
    toggleGlobalMute();
    for (const [id, state] of Object.entries(stems)) {
      if (state.muted) engine.setStemMuted(id, newActive);
    }
  }, [globalMuteActive, toggleGlobalMute, stems, engine]);

  const handleClearMute = useCallback(() => {
    for (const [id, state] of Object.entries(stems)) {
      if (state.muted) engine.setStemMuted(id, false);
    }
    clearMuteGroup();
  }, [stems, engine, clearMuteGroup]);

  const soloHandlers = useLongPress(handleToggleSolo, handleClearSolo);
  const muteHandlers = useLongPress(handleToggleMute, handleClearMute);

  // Save default mixer state
  const bandId = useBandStore((s) => s.currentBand?.id);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSaveClick = useCallback(async () => {
    if (saveState === 'pending') {
      // Cancel
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      setSaveState('cancelled');
      setTimeout(() => setSaveState('idle'), 1500);
      return;
    }

    if (saveState !== 'idle') return;

    setSaveState('pending');
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      if (!selectedSong || !bandId) return;

      setSaveState('saving');
      try {
        const updatedConfig = {
          id: selectedSong.id,
          title: selectedSong.title,
          artist: selectedSong.artist,
          key: selectedSong.key,
          durationSeconds: selectedSong.durationSeconds,
          beatOffset: selectedSong.beatOffset,
          tempoMap: selectedSong.tempoMap,
          timeSignatureMap: selectedSong.timeSignatureMap,
          metronome: selectedSong.metronome,
          markers: selectedSong.markers,
          ...(selectedSong.groups !== undefined && { groups: selectedSong.groups }),
          ...(selectedSong.tapMap !== undefined && { tapMap: selectedSong.tapMap }),
          ...(selectedSong.navLinks !== undefined && { navLinks: selectedSong.navLinks }),
          stems: selectedSong.stems.map((stem) => ({
            id: stem.id,
            label: stem.label,
            file: stem.file,
            color: stem.color,
            ...(stem.stereo !== undefined && { stereo: stem.stereo }),
            defaultVolume: Math.min(1.5, stems[stem.id]?.volume ?? stem.defaultVolume),
            defaultPan: Math.max(-1, Math.min(1, stems[stem.id]?.pan ?? stem.defaultPan)),
          })),
        };
        const res = await fetch(`/api/bands/${bandId}/songs/${selectedSong.id}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } catch {
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 2000);
      }
    }, 3000);
  }, [saveState, selectedSong, bandId, stems]);

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
      {/* Global mute/solo + save defaults */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 mb-3">
        <div className="flex gap-2 w-full md:w-[230px]">
          <button
            {...muteHandlers}
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
            {...soloHandlers}
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
        {import.meta.env.DEV && (
          <button
            onClick={handleSaveClick}
            className={`flex items-center gap-1.5 text-xs px-2 py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors ${
              saveState === 'saved'
                ? 'text-green-400'
                : saveState === 'error'
                  ? 'text-red-400'
                  : saveState === 'cancelled'
                    ? 'text-gray-400'
                    : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Save current mixer as default"
          >
            {saveState === 'idle' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            )}
            {(saveState === 'pending' || saveState === 'saving') && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
              </svg>
            )}
            {saveState === 'cancelled' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            {saveState === 'saved' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {saveState === 'error' && (
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            {saveState === 'pending' && <span>Saving Default Mixer State - Click again to cancel</span>}
            {saveState === 'saving' && <span>Saving...</span>}
            {saveState === 'cancelled' && <span>Save cancelled</span>}
            {saveState === 'saved' && <span>Saved</span>}
            {saveState === 'error' && <span>Save failed</span>}
          </button>
        )}
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
