import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { songManifestSchema, songConfigSchema } from '../../config/schema';
import { assetUrl } from '../../utils/url';
import type { SongManifestEntry } from '../../audio/types';

export function SongList() {
  const engine = useAudioEngine();
  const { manifest, selectedSong, loading, loadProgress, setManifest, setSelectedSong, setLoading, setLoadProgress, setError } =
    useSongStore();
  const { initStems, initGroups } = useMixerStore();
  const currentBand = useBandStore((s) => s.currentBand);
  const loadingRef = useRef(false);

  useEffect(() => {
    fetch(assetUrl('audio/manifest.json'))
      .then((r) => r.json())
      .then((data) => {
        const parsed = songManifestSchema.parse(data);
        setManifest(parsed);
      })
      .catch((err) => setError(String(err)));
  }, [setManifest, setError]);

  const filteredSongs = useMemo(() => {
    if (!manifest) return [];
    if (!currentBand) return manifest.songs;
    return manifest.songs.filter((s) => currentBand.songIds.includes(s.id));
  }, [manifest, currentBand]);

  const handleSelect = useCallback(async (entry: SongManifestEntry) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
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

      // Initialize mixer store with stem defaults
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

      // Initialize group state
      const groupStates: Record<string, { volume: number; muted: boolean; soloed: boolean; expanded: boolean }> = {};
      for (const group of config.groups ?? []) {
        groupStates[group.id] = { volume: 1, muted: false, soloed: false, expanded: false };
      }
      initGroups(groupStates);
    } catch (err) {
      setError(String(err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [engine, setLoading, setError, setLoadProgress, setSelectedSong, initStems, initGroups]);

  // Auto-select song from URL hash on initial load
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

  // Listen for popstate (browser back/forward)
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

  if (!manifest) {
    return <div className="text-gray-400 p-4">Loading song list...</div>;
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
      <label className="text-sm text-gray-400 shrink-0">Song:</label>
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
      {loading && loadProgress && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-1 bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 shrink-0">
            {loadProgress.loaded}/{loadProgress.total}
          </span>
        </div>
      )}
    </div>
  );
}
