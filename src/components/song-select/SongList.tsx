import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useSetlistStore } from '../../store/setlistStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { songManifestSchema, songConfigSchema, setlistConfigSchema } from '../../config/schema';
import { r2Url } from '../../utils/url';
import type { SongManifestEntry, SetlistConfig } from '../../audio/types';

export function useSongLoader() {
  const engine = useAudioEngine();
  const { initStems, initGroups } = useMixerStore();
  const currentBand = useBandStore((s) => s.currentBand);
  const manifest = useSongStore((s) => s.manifest);
  const setLoading = useSongStore((s) => s.setLoading);
  const setLoadProgress = useSongStore((s) => s.setLoadProgress);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const setError = useSongStore((s) => s.setError);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);

  const filteredSongs = useMemo(() => {
    if (!manifest) return [];
    if (activeSetlist) {
      return activeSetlist.entries
        .filter((e) => e.type === 'song')
        .map((e) => e.type === 'song' ? manifest.songs.find((s) => s.id === e.songId) : undefined)
        .filter((s): s is SongManifestEntry => !!s);
    }
    return [...manifest.songs].sort((a, b) => a.title.localeCompare(b.title));
  }, [manifest, activeSetlist]);

  const handleSelect = useCallback(async (entry: SongManifestEntry) => {
    if (useSongStore.getState().loading) return;
    setLoading(true);
    setError(null);

    try {
      const bandId = currentBand?.id;
      const configUrl = r2Url(`${bandId}/songs/${entry.id}/config.json`);
      const res = await fetch(configUrl);
      const configData = await res.json();
      const config = songConfigSchema.parse(configData);

      const audioBase = entry.audioBasePath ?? r2Url(`${bandId}/song-${entry.id}`);
      await engine.loadSong(config, audioBase, (loaded, total) => {
        setLoadProgress(loaded, total);
      });

      setSelectedSong(config);
      const setlistState = useSetlistStore.getState();
      if (setlistState.activeSetlist) {
        history.pushState(null, '', `#${setlistState.activeIndex + 1}`);
      } else {
        history.pushState(null, '', `#${entry.id}`);
      }

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

/** Headless component — runs manifest fetch, setlist index fetch, auto-select, and popstate effects. Renders nothing. */
export function SongList() {
  const { filteredSongs, handleSelect } = useSongLoader();
  const setManifest = useSongStore((s) => s.setManifest);
  const setError = useSongStore((s) => s.setError);
  const currentBand = useBandStore((s) => s.currentBand);
  const setSetlistIndex = useSetlistStore((s) => s.setIndex);

  useEffect(() => {
    if (!currentBand) return;
    fetch(r2Url(`${currentBand.id}/songs/discography.json`))
      .then((r) => r.json())
      .then((data) => {
        const parsed = songManifestSchema.parse(data);
        setManifest(parsed);
      })
      .catch((err) => setError(String(err)));
  }, [currentBand, setManifest, setError]);

  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);

  // Load setlist index from R2
  useEffect(() => {
    if (!currentBand) return;
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    if (!r2Base) return;
    fetch(`${r2Base}/${currentBand.id}/setlists/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error('No setlists');
        return r.json();
      })
      .then((data) => setSetlistIndex(data.setlists ?? []))
      .catch(() => setSetlistIndex([]));
  }, [currentBand, setSetlistIndex]);

  // Preload setlist from URL ?setlist= parameter
  const hasPreloadedSetlist = useRef(false);
  const setlistPending = useRef(false);
  useEffect(() => {
    if (hasPreloadedSetlist.current || !currentBand) return;
    const params = new URLSearchParams(window.location.search);
    const setlistParam = params.get('setlist');
    if (!setlistParam) return;
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    if (!r2Base) return;
    hasPreloadedSetlist.current = true;
    setlistPending.current = true;
    const fullId = setlistParam.startsWith('setlist-') ? setlistParam : `setlist-${setlistParam}`;
    fetch(`${r2Base}/${currentBand.id}/setlists/${fullId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((data) => {
        const config = setlistConfigSchema.parse(data);
        setActiveSetlist(config);
      })
      .catch(() => {})
      .finally(() => { setlistPending.current = false; });
  }, [currentBand, setActiveSetlist]);

  const hasAutoLoaded = useRef(false);
  const setActiveIndex = useSetlistStore((s) => s.setActiveIndex);
  useEffect(() => {
    // Wait for setlist preload to complete before auto-selecting a song
    if (hasAutoLoaded.current || setlistPending.current || filteredSongs.length === 0) return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const activeSetlist = useSetlistStore.getState().activeSetlist;
    if (activeSetlist) {
      // Hash is a 1-based song index when setlist is active
      const idx = parseInt(hash) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < filteredSongs.length) {
        hasAutoLoaded.current = true;
        setActiveIndex(idx);
        handleSelect(filteredSongs[idx]);
      }
    } else {
      const entry = filteredSongs.find((s) => s.id === hash);
      if (entry) {
        hasAutoLoaded.current = true;
        handleSelect(entry);
      }
    }
  }, [filteredSongs, handleSelect, setActiveIndex]);

  useEffect(() => {
    const onPopState = () => {
      const hash = window.location.hash.replace('#', '');
      if (!hash) return;
      const activeSetlist = useSetlistStore.getState().activeSetlist;
      if (activeSetlist) {
        const idx = parseInt(hash) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < filteredSongs.length) {
          setActiveIndex(idx);
          handleSelect(filteredSongs[idx]);
        }
      } else {
        if (hash === useSongStore.getState().selectedSong?.id) return;
        const entry = filteredSongs.find((s) => s.id === hash);
        if (entry) handleSelect(entry);
      }
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
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const activeIndex = useSetlistStore((s) => s.activeIndex);
  const setActiveIndex = useSetlistStore((s) => s.setActiveIndex);

  const inSetlist = !!activeSetlist;

  // Build grouped options for setlist mode (must be before early return to preserve hook order)
  const setlistOptions = useMemo(() => {
    if (!inSetlist || !activeSetlist || !manifest) return null;
    const groups: { label: string | null; songs: { idx: number; song: SongManifestEntry }[] }[] = [];
    let current: (typeof groups)[number] = { label: null, songs: [] };
    groups.push(current);
    let songIdx = 0;
    for (const entry of activeSetlist.entries) {
      if (entry.type === 'heading') {
        current = { label: entry.label, songs: [] };
        groups.push(current);
      } else {
        const song = manifest.songs.find((s) => s.id === entry.songId);
        if (song) {
          current.songs.push({ idx: songIdx, song });
          songIdx++;
        }
      }
    }
    return groups;
  }, [inSetlist, activeSetlist, manifest]);

  if (!manifest) return null;

  return (
    <select
      className="bg-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
      value={inSetlist ? String(activeIndex) : (selectedSong?.id ?? '')}
      onChange={(e) => {
        if (inSetlist) {
          const idx = parseInt(e.target.value);
          setActiveIndex(idx);
          const entry = filteredSongs[idx];
          if (entry) handleSelect(entry);
        } else {
          const entry = filteredSongs.find((s) => s.id === e.target.value);
          if (entry) handleSelect(entry);
        }
      }}
      disabled={loading}
    >
      <option value={inSetlist ? '-1' : ''} disabled>
        {loading ? 'Loading...' : 'Select a song'}
      </option>
      {inSetlist && setlistOptions
        ? setlistOptions.map((group, gi) => {
            const options = group.songs.map(({ idx, song }) => (
              <option key={idx} value={String(idx)}>
                {song.title} — {song.artist}
              </option>
            ));
            return group.label
              ? <optgroup key={gi} label={group.label}>{options}</optgroup>
              : options;
          })
        : filteredSongs.map((song) => (
            <option key={song.id} value={song.id}>
              {song.title} — {song.artist}
            </option>
          ))
      }
    </select>
  );
}

/** Setlist picker dropdown — rendered inside AudioEngineContext.Provider */
export function SetlistDropdown() {
  const currentBand = useBandStore((s) => s.currentBand);
  const setlistIndex = useSetlistStore((s) => s.index);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const setActiveSetlist = useSetlistStore((s) => s.setActiveSetlist);
  const { filteredSongs, handleSelect } = useSongLoader();

  const handleSetlistChange = async (setlistId: string) => {
    if (!currentBand) return;
    if (setlistId === '') {
      setActiveSetlist(null);
      const url = new URL(window.location.href);
      url.searchParams.delete('setlist');
      const songId = useSongStore.getState().selectedSong?.id;
      url.hash = songId ? `#${songId}` : '';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      return;
    }
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    try {
      const res = await fetch(`${r2Base}/${currentBand.id}/setlists/${setlistId}.json`);
      const data: SetlistConfig = setlistConfigSchema.parse(await res.json());
      setActiveSetlist(data);
      const url = new URL(window.location.href);
      url.searchParams.set('setlist', setlistId.replace(/^setlist-/, ''));
      // activeIndex resets to 0 via setActiveSetlist, so first song
      url.hash = '#1';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {
      // silently fail
    }
  };

  // When setlist changes, load first song
  const prevSetlistId = useRef(activeSetlist?.id);
  useEffect(() => {
    if (activeSetlist && activeSetlist.id !== prevSetlistId.current && filteredSongs.length > 0) {
      handleSelect(filteredSongs[0]);
    }
    prevSetlistId.current = activeSetlist?.id;
  }, [activeSetlist, filteredSongs, handleSelect]);

  if (!setlistIndex || setlistIndex.length === 0) return null;

  return (
    <select
      className="ml-auto bg-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
      value={activeSetlist?.id ?? ''}
      onChange={(e) => handleSetlistChange(e.target.value)}
    >
      <option value="">All Songs</option>
      <option disabled>──────────</option>
      {setlistIndex.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}

/** Song dropdown with prev/next when a setlist is active, plain dropdown otherwise */
export function SetlistNav() {
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const activeIndex = useSetlistStore((s) => s.activeIndex);
  const setActiveIndex = useSetlistStore((s) => s.setActiveIndex);
  const loading = useSongStore((s) => s.loading);
  const { filteredSongs, handleSelect } = useSongLoader();

  if (!activeSetlist) return <SongSelectDropdown />;

  const prevSong = activeIndex > 0 ? filteredSongs[activeIndex - 1] : null;
  const nextSong = activeIndex < filteredSongs.length - 1 ? filteredSongs[activeIndex + 1] : null;

  const navigate = (idx: number) => {
    setActiveIndex(idx);
    const entry = filteredSongs[idx];
    if (entry) handleSelect(entry);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={!prevSong || loading}
        onClick={() => navigate(activeIndex - 1)}
        className="text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 disabled:cursor-default whitespace-nowrap"
      >
        {prevSong ? `\u2190 ${prevSong.title}` : ''}
      </button>
      <SongSelectDropdown />
      <button
        disabled={!nextSong || loading}
        onClick={() => navigate(activeIndex + 1)}
        className="text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 disabled:cursor-default whitespace-nowrap"
      >
        {nextSong ? `${nextSong.title} \u2192` : ''}
      </button>
    </div>
  );
}
