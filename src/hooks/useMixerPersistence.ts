import { useEffect } from 'react';
import { useMixerStore } from '../store/mixerStore';
import { useSongStore } from '../store/songStore';
import { saveMixerState, type SavedMixerState } from '../utils/mixerStorage';

export function useMixerPersistence() {
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsub = useMixerStore.subscribe((state) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const songId = useSongStore.getState().selectedSong?.id;
        if (!songId) return;

        const groups: SavedMixerState['groups'] = {};
        for (const [id, g] of Object.entries(state.groups)) {
          groups[id] = { volume: g.volume, muted: g.muted, soloed: g.soloed };
        }

        saveMixerState(songId, {
          masterVolume: state.masterVolume,
          stems: state.stems,
          groups,
          globalMuteActive: state.globalMuteActive,
          globalSoloActive: state.globalSoloActive,
        });
      }, 500);
    });

    return () => {
      unsub();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);
}
