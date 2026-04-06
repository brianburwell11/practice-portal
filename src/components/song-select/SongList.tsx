import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { songManifestSchema, songConfigSchema } from '../../config/schema';
import { assetUrl } from '../../utils/url';
import type { SongManifestEntry } from '../../audio/types';

function useSongLoader() {
  const engine = useAudioEngine();
  const { initStems, initGroups } = useMixerStore();
  const currentBand = useBandStore((s) => s.currentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setLoading = useSongStore((s) => s.setLoading);
  const setLoadProgress = useSongStore((s) => s.setLoadProgress);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const setError = useSongStore((s) => s.setError);

  const filteredSongs = useMemo(() => {
    if (!manifest) return [];
    if (!currentBand) return manifest.songs;
    return manifest.songs.filter((s) => currentBand.songIds.includes(s.id));
  }, [manifest, currentBand]);

  const handleSelect = useCallback(async (entry: SongManifestEntry) => {
    if (useSongStore.getState().loading) return;
    setLoading(true);
    setError(null);

    try {
      const configUrl = assetUrl(`${entry.path}/config.json`);
      const res = await fetch(configUrl);
      const configData = await res.json();
      const config = songConfigSchema.parse(configData);

      const audioBase = entry.audioBasePath ?? assetUrl(entry.path);
      await engine.loadSong(config, audioBase, (loaded, total) => {
        setLoadProgress(loaded, total);
      });

      setSelectedSong(config);
      history.pushState(null, '', `#${entry.id}`);

      const stemStates: Record<string, { volume: number; pan: number; muted: boolean; soloed: boolean }> = {};
      for (const stem of config.stems) {
        stemStates[stem.id] = {
          volume: stem.defaultVolume,
          pan: stem.defaultPan,
          muted: false,
          soloed: false,
        };
      }
      initStems(stemStates);

      const groupStates: Record<string, { volume: number; muted: boolean; soloed: boolean; expanded: boolean }> = {};
      for (const group of config.groups ?? []) {
        groupStates[group.id] = { volume: 1, muted: false, soloed: false, expanded: false };
      }
      initGroups(groupStates);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [engine, setLoading, setError, setLoadProgress, setSelectedSong, initStems, initGroups]);

  return { filteredSongs, handleSelect };
}

/** Headless component — runs manifest fetch, auto-select, and popstate effects. Renders nothing. */
export function SongList() {
  const { filteredSongs, handleSelect } = useSongLoader();
  const setManifest = useSongStore((s) => s.setManifest);
  const setError = useSongStore((s) => s.setError);

  useEffect(() => {
    fetch(assetUrl('audio/manifest.json'))
      .then((r) => r.json())
      .then((data) => {
        const parsed = songManifestSchema.parse(data);
        setManifest(parsed);
      })
      .catch((err) => setError(String(err)));
  }, [setManifest, setError]);

  const hasAutoLoaded = useRef(false);
  useEffect(() => {
    if (hasAutoLoaded.current || filteredSongs.length === 0) return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const entry = filteredSongs.find((s) => s.id === hash);
    if (entry) {
      hasAutoLoaded.current = true;
      handleSelect(entry);
    }
  }, [filteredSongs, handleSelect]);

  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash.replace('#', '');
      if (!hash || hash === useSongStore.getState().selectedSong?.id) return;
      const entry = filteredSongs.find((s) => s.id === hash);
      if (entry) handleSelect(entry);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [filteredSongs, handleSelect]);

  return null;
}

export function SongSelectDropdown() {
  const { filteredSongs, handleSelect } = useSongLoader();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const loading = useSongStore((s) => s.loading);
  const manifest = useSongStore((s) => s.manifest);

  if (!manifest) return null;

  return (
    <select
      className="bg-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
      value={selectedSong?.id ?? ''}
      onChange={(e) => {
        const entry = filteredSongs.find((s) => s.id === e.target.value);
        if (entry) handleSelect(entry);
      }}
      disabled={loading}
    >
      <option value="" disabled>
        {loading ? 'Loading...' : 'Select a song'}
      </option>
      {filteredSongs.map((song) => (
        <option key={song.id} value={song.id}>
          {song.title} — {song.artist}
        </option>
      ))}
    </select>
  );
}
