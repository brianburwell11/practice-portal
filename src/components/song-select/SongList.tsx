import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { useSetlistStore } from '../../store/setlistStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { songManifestSchema, songConfigSchema, setlistConfigSchema } from '../../config/schema';
import { r2Url } from '../../utils/url';
import { loadMixerState } from '../../utils/mixerStorage';
import { useLyricsStore } from '../../store/lyricsStore';
import type { SongManifestEntry, SetlistConfig } from '../../audio/types';

export function useSongLoader() {
  const engine = useAudioEngine();
  const { initStems, initGroups, setMasterVolume } = useMixerStore();
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
    useLyricsStore.getState().clear();

    try {
      const bandId = currentBand?.id;
      const configUrl = r2Url(`${bandId}/songs/${entry.id}/config.json`);
      const res = await fetch(configUrl);
      const configData = await res.json();
      const config = songConfigSchema.parse(configData);

      const audioBase = entry.audioBasePath ?? r2Url(`${bandId}/songs/${entry.id}`);
      await engine.loadSong(config, audioBase, (loaded, total) => {
        setLoadProgress(loaded, total);
      });

      setSelectedSong(config);

      // Load lyrics (non-blocking)
      fetch(r2Url(`${bandId}/songs/${entry.id}/lyrics.json`))
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => useLyricsStore.getState().setLyrics(data?.lines ?? []))
        .catch(() => useLyricsStore.getState().setLyrics([]));

      const setlistState = useSetlistStore.getState();
      if (setlistState.activeSetlist) {
        history.pushState(null, '', `#${setlistState.activeIndex + 1}`);
      } else {
        // Prefer the song's slug (readable kebab-case) when present;
        // legacy songs fall back to their slug-shaped id, which
        // matches the pre-refactor hash so bookmarks keep resolving.
        const hashSegment = config.slug ?? entry.slug ?? entry.id;
        history.pushState(null, '', `#${hashSegment}`);
      }

      const saved = loadMixerState(config.id);

      const stemStates: Record<string, { volume: number; pan: number; muted: boolean; soloed: boolean; stereo: boolean }> = {};
      for (const stem of config.stems) {
        const s = saved?.stems[stem.id];
        stemStates[stem.id] = {
          volume: s?.volume ?? stem.defaultVolume,
          pan: s?.pan ?? stem.defaultPan,
          muted: s?.muted ?? false,
          soloed: s?.soloed ?? false,
          stereo: s?.stereo ?? (stem.stereo ?? false),
        };
      }
      // Preserve whether the mute/solo groups were active at save time.
      // Older saved entries (before this field existed) fall back to
      // "active when any stem is muted/soloed" so saved mute/solo audibly
      // kicks in on reload, matching prior behavior.
      const savedMuteActive = saved?.globalMuteActive ?? Object.values(stemStates).some((s) => s.muted);
      const savedSoloActive = saved?.globalSoloActive ?? Object.values(stemStates).some((s) => s.soloed);
      initStems(stemStates, { muteActive: savedMuteActive, soloActive: savedSoloActive });

      const groupStates: Record<string, { volume: number; muted: boolean; soloed: boolean; expanded: boolean }> = {};
      for (const group of config.groups ?? []) {
        const g = saved?.groups[group.id];
        groupStates[group.id] = {
          volume: g?.volume ?? group.defaultVolume ?? 1,
          muted: g?.muted ?? false,
          soloed: g?.soloed ?? false,
          expanded: false,
        };
      }
      initGroups(groupStates);

      // Apply saved mixer state to audio engine (which initialized with config defaults)
      if (saved) {
        setMasterVolume(saved.masterVolume);
        engine.setMasterVolume(saved.masterVolume);
        for (const stem of config.stems) {
          const ss = stemStates[stem.id];
          engine.setStemVolume(stem.id, ss.volume);
          engine.setStemPan(stem.id, ss.pan);
          // Engine mute/solo only fires when the respective group is active;
          // otherwise the stem is "armed but not suppressing audio".
          engine.setStemMuted(stem.id, ss.muted && savedMuteActive);
          engine.setStemSoloed(stem.id, ss.soloed && savedSoloActive);
          engine.setStemStereo(stem.id, ss.stereo);
        }
        for (const group of config.groups ?? []) {
          const gs = groupStates[group.id];
          engine.setGroupVolume(group.id, gs.volume);
          engine.setGroupMuted(group.id, gs.muted);
          engine.setGroupSoloed(group.id, gs.soloed);
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [engine, setLoading, setError, setLoadProgress, setSelectedSong, setMasterVolume, initStems, initGroups]);

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

    // Resolve the URL param (slug, opaque id, or legacy "setlist-…")
    // against the index. The index is loaded by a sibling effect and
    // may not be ready yet — fall through to the candidate-id loader
    // below, which probes each plausible shape in turn.
    const idx = useSetlistStore.getState().index ?? [];
    const bySlug = idx.find((s) => s.slug && s.slug === setlistParam);
    const byId = idx.find((s) => s.id === setlistParam);
    const byLegacyId = idx.find((s) => s.id === `setlist-${setlistParam}`);
    const candidateIds: string[] = [];
    if (bySlug) candidateIds.push(bySlug.id);
    else if (byId) candidateIds.push(byId.id);
    else if (byLegacyId) candidateIds.push(byLegacyId.id);
    else {
      // Index unavailable \u2014 fall back to probing the raw param and
      // the legacy-prefixed form. Preserves the pre-refactor behavior
      // for deep-linked URLs that land before the index loads.
      candidateIds.push(setlistParam);
      if (!setlistParam.startsWith('setlist-')) {
        candidateIds.push(`setlist-${setlistParam}`);
      }
    }

    const tryLoad = async () => {
      for (const id of candidateIds) {
        try {
          const r = await fetch(`${r2Base}/${currentBand.id}/setlists/${id}.json`);
          if (!r.ok) continue;
          const data = await r.json();
          const config = setlistConfigSchema.parse(data);
          setActiveSetlist(config);
          return;
        } catch {
          // try next candidate
        }
      }
    };
    tryLoad().finally(() => { setlistPending.current = false; });
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
      // Look up by slug first (new songs), fall back to id
      // (legacy songs whose id is already a slug).
      const entry =
        filteredSongs.find((s) => s.slug && s.slug === hash) ??
        filteredSongs.find((s) => s.id === hash);
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
        const sel = useSongStore.getState().selectedSong;
        if (sel && (hash === sel.slug || hash === sel.id)) return;
        const entry =
          filteredSongs.find((s) => s.slug && s.slug === hash) ??
          filteredSongs.find((s) => s.id === hash);
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
      className="bg-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 w-48 shrink text-center md:text-left md:w-auto md:shrink-0"
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
      const sel = useSongStore.getState().selectedSong;
      const hashSegment = sel ? (sel.slug ?? sel.id) : '';
      url.hash = hashSegment ? `#${hashSegment}` : '';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      return;
    }
    const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
    try {
      const res = await fetch(`${r2Base}/${currentBand.id}/setlists/${setlistId}.json`);
      const data: SetlistConfig = setlistConfigSchema.parse(await res.json());
      setActiveSetlist(data);
      const url = new URL(window.location.href);
      // Prefer the setlist's slug in the URL. For legacy setlists
      // (no slug), strip the "setlist-" prefix to keep the param
      // compact \u2014 matches the pre-refactor URL shape.
      url.searchParams.set(
        'setlist',
        data.slug ?? setlistId.replace(/^setlist-/, ''),
      );
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

  const prevSong = activeSetlist && activeIndex > 0 ? filteredSongs[activeIndex - 1] : null;
  const nextSong = activeSetlist && activeIndex < filteredSongs.length - 1 ? filteredSongs[activeIndex + 1] : null;

  const navigate = (idx: number) => {
    setActiveIndex(idx);
    const entry = filteredSongs[idx];
    if (entry) handleSelect(entry);
  };

  return (
    <div className="flex items-center gap-1 md:gap-3 w-full md:w-auto md:max-w-none">
      <div className="flex-1 md:flex-initial text-left py-2 px-3 md:px-0">
        {activeSetlist && (
          <button
            disabled={!prevSong || loading}
            onClick={() => navigate(activeIndex - 1)}
            className="text-sm md:text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 disabled:cursor-default"
          >
            {prevSong ? (
              <>
                <span>{'\u2190'}</span>
                <span className="hidden md:inline"> {prevSong.title}</span>
              </>
            ) : ''}
          </button>
        )}
      </div>
      <SongSelectDropdown />
      <div className="flex-1 md:flex-initial text-right py-2 px-3 md:px-0">
        {activeSetlist && (
          <button
            disabled={!nextSong || loading}
            onClick={() => navigate(activeIndex + 1)}
            className="text-sm md:text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 disabled:cursor-default"
          >
            {nextSong ? (
              <>
                <span className="hidden md:inline">{nextSong.title} </span>
                <span>{'\u2192'}</span>
              </>
            ) : ''}
          </button>
        )}
      </div>
    </div>
  );
}
