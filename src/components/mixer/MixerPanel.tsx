import { useMemo, useCallback, useState, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useLongPress } from '../../hooks/useLongPress';
import { ChannelStrip } from './ChannelStrip';
import { GroupStrip } from './GroupStrip';
import { resolveMixerOrder } from '../../audio/mixerOrder';

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

  // Global reset: restore every stem, group, and master volume to the
  // config defaults. Pushes to the audio engine in addition to the store so
  // audio reflects the change immediately.
  const setMasterVolume = useMixerStore((s) => s.setMasterVolume);
  const setStemVolume = useMixerStore((s) => s.setStemVolume);
  const setStemPan = useMixerStore((s) => s.setStemPan);
  const setGroupVolume = useMixerStore((s) => s.setGroupVolume);
  const setGroupMuted = useMixerStore((s) => s.setGroupMuted);
  const setGroupSoloed = useMixerStore((s) => s.setGroupSoloed);

  const handleResetAll = useCallback(() => {
    if (!selectedSong) return;

    setMasterVolume(1);
    engine.setMasterVolume(1);

    for (const stem of selectedSong.stems) {
      setStemVolume(stem.id, stem.defaultVolume);
      engine.setStemVolume(stem.id, stem.defaultVolume);
      setStemPan(stem.id, stem.defaultPan);
      engine.setStemPan(stem.id, stem.defaultPan);
      engine.setStemMuted(stem.id, false);
      engine.setStemSoloed(stem.id, false);
    }
    // Single-pass store updates + global flag reset.
    clearMuteGroup();
    clearSoloGroup();

    for (const group of selectedSong.groups ?? []) {
      const v = group.defaultVolume ?? 1;
      setGroupVolume(group.id, v);
      engine.setGroupVolume(group.id, v);
      setGroupMuted(group.id, false);
      engine.setGroupMuted(group.id, false);
      setGroupSoloed(group.id, false);
      engine.setGroupSoloed(group.id, false);
    }
  }, [selectedSong, engine, setMasterVolume, setStemVolume, setStemPan, setGroupVolume, setGroupMuted, setGroupSoloed, clearMuteGroup, clearSoloGroup]);

  const masterVolume = useMixerStore((s) => s.masterVolume);
  const groups = useMixerStore((s) => s.groups);

  const mixerIsAtDefaults = useMemo(() => {
    if (!selectedSong) return true;
    if (Math.abs(masterVolume - 1) >= 0.001) return false;
    for (const stem of selectedSong.stems) {
      const s = stems[stem.id];
      if (!s) continue;
      if (Math.abs(s.volume - stem.defaultVolume) >= 0.001) return false;
      if (Math.abs(s.pan - stem.defaultPan) >= 0.001) return false;
      if (s.muted || s.soloed) return false;
    }
    for (const group of selectedSong.groups ?? []) {
      const g = groups[group.id];
      if (!g) continue;
      if (Math.abs(g.volume - (group.defaultVolume ?? 1)) >= 0.001) return false;
      if (g.muted || g.soloed) return false;
    }
    return true;
  }, [selectedSong, masterVolume, stems, groups]);

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
        // Spread the whole song config and only override stem + group
        // defaults so we don't drop tags, offsetSec, or anything else the
        // song happens to carry.
        const updatedConfig = {
          ...selectedSong,
          stems: selectedSong.stems.map((stem) => ({
            ...stem,
            defaultVolume: Math.min(1.5, stems[stem.id]?.volume ?? stem.defaultVolume),
            defaultPan: Math.max(-1, Math.min(1, stems[stem.id]?.pan ?? stem.defaultPan)),
          })),
          ...(selectedSong.groups ? {
            groups: selectedSong.groups.map((group) => ({
              ...group,
              defaultVolume: Math.min(1.5, groups[group.id]?.volume ?? group.defaultVolume ?? 1),
            })),
          } : {}),
        };
        const res = await fetch(`/api/bands/${bandId}/songs/${selectedSong.id}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig),
        });
        if (!res.ok) throw new Error('Save failed');
        // Reflect the new defaults on the in-memory selectedSong too, so any
        // downstream code reading selectedSong (e.g. the mixer reset) now
        // agrees with what's on R2.
        useSongStore.getState().setSelectedSong(updatedConfig);
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } catch {
        setSaveState('error');
        setTimeout(() => setSaveState('idle'), 2000);
      }
    }, 3000);
  }, [saveState, selectedSong, bandId, stems, groups]);

  // Top-level mixer order: groups + ungrouped stems, ordered by
  // `mixerOrder` when set (with legacy fallback for missing items).
  const mixerItems = useMemo(() => resolveMixerOrder(selectedSong), [selectedSong]);

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
        {/* Mobile-only full-width reset bar, above the M/S buttons */}
        <button
          onClick={handleResetAll}
          disabled={mixerIsAtDefaults}
          className={`md:hidden flex items-center justify-center gap-2 w-full py-2 rounded text-xs font-medium transition-colors ${
            mixerIsAtDefaults
              ? 'bg-gray-900 text-gray-600 cursor-default'
              : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
          }`}
          title="Reset mixer to defaults"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M12 2a10 10 0 0 1 8.5 4.7l-2.3-.4a1.2 1.2 0 1 0-.4 2.4l4.6.8a1.2 1.2 0 0 0 1.4-1l.8-4.6a1.2 1.2 0 0 0-2.4-.4l-.3 1.8A12 12 0 0 0 0 12a1.2 1.2 0 0 0 2.4 0A9.6 9.6 0 0 1 12 2ZM12 22a10 10 0 0 1-8.5-4.7l2.3.4a1.2 1.2 0 1 0 .4-2.4l-4.6-.8a1.2 1.2 0 0 0-1.4 1l-.8 4.6a1.2 1.2 0 0 0 2.4.4l.3-1.8A12 12 0 0 0 24 12a1.2 1.2 0 0 0-2.4 0A9.6 9.6 0 0 1 12 22Z" />
          </svg>
          RESET MIXER TO DEFAULT SETTINGS
        </button>
        <div className="flex gap-2 w-full md:w-[230px]">
          <button
            {...(anyMuted ? muteHandlers : {})}
            disabled={!anyMuted}
            className={`flex-1 flex items-center justify-center gap-0.5 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
              !anyMuted
                ? 'bg-gray-800 text-gray-600 border-transparent cursor-default'
                : globalMuteActive
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-gray-700 text-gray-400 border-red-600'
            }`}
          >
            <span className="text-xs leading-none">M</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
            </svg>
          </button>
          <button
            {...(anySoloed ? soloHandlers : {})}
            disabled={!anySoloed}
            className={`flex-1 flex items-center justify-center gap-0.5 text-xs py-1 min-h-[44px] md:min-h-0 rounded font-medium transition-colors border-2 ${
              !anySoloed
                ? 'bg-gray-800 text-gray-600 border-transparent cursor-default'
                : globalSoloActive
                  ? 'bg-yellow-500 text-gray-900 border-yellow-500'
                  : 'bg-gray-700 text-gray-400 border-yellow-500'
            }`}
          >
            <span className="text-xs leading-none">S</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
            </svg>
          </button>
        </div>
        {/* Desktop-only reset icon — sits left of the save button */}
        <button
          onClick={handleResetAll}
          disabled={mixerIsAtDefaults}
          className={`hidden md:inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded font-medium transition-colors ${
            mixerIsAtDefaults ? 'text-gray-700 cursor-default' : 'text-gray-500 hover:text-gray-300'
          }`}
          title="Reset mixer to defaults"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2a10 10 0 0 1 8.5 4.7l-2.3-.4a1.2 1.2 0 1 0-.4 2.4l4.6.8a1.2 1.2 0 0 0 1.4-1l.8-4.6a1.2 1.2 0 0 0-2.4-.4l-.3 1.8A12 12 0 0 0 0 12a1.2 1.2 0 0 0 2.4 0A9.6 9.6 0 0 1 12 2ZM12 22a10 10 0 0 1-8.5-4.7l2.3.4a1.2 1.2 0 1 0 .4-2.4l-4.6-.8a1.2 1.2 0 0 0-1.4 1l-.8 4.6a1.2 1.2 0 0 0 2.4.4l.3-1.8A12 12 0 0 0 24 12a1.2 1.2 0 0 0-2.4 0A9.6 9.6 0 0 1 12 22Z" />
          </svg>
        </button>
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

      {/* Groups and ungrouped stems, in user-configured display order */}
      <div className="flex flex-col md:flex-row gap-3 md:flex-wrap md:items-start">
        {mixerItems.map((item) => {
          if (item.kind === 'group') {
            const stemConfigs = item.group.stemIds
              .map((id) => selectedSong.stems.find((s) => s.id === id))
              .filter((s) => s != null);
            return <GroupStrip key={item.id} groupConfig={item.group} stemConfigs={stemConfigs} />;
          }
          return <ChannelStrip key={item.id} stemConfig={item.stem} />;
        })}
      </div>
    </div>
  );
}
