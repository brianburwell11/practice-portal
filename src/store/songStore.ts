import { create } from 'zustand';
import type { SongConfig, SongManifest, SongManifestEntry } from '../audio/types';

interface SongState {
  manifest: SongManifest | null;
  selectedSong: SongConfig | null;
  loading: boolean;
  loadProgress: { loaded: number; total: number } | null;
  error: string | null;
  /** The song whose load failed, to retry. Null when it was the song list that failed. */
  failedSong: SongManifestEntry | null;
  setManifest: (m: SongManifest) => void;
  setSelectedSong: (s: SongConfig | null) => void;
  setLoading: (l: boolean) => void;
  setLoadProgress: (loaded: number, total: number) => void;
  setError: (e: string | null, failedSong?: SongManifestEntry | null) => void;
}

export const useSongStore = create<SongState>((set) => ({
  manifest: null,
  selectedSong: null,
  loading: false,
  loadProgress: null,
  error: null,
  failedSong: null,
  setManifest: (manifest) => set({ manifest }),
  setSelectedSong: (selectedSong) => set({ selectedSong }),
  setLoading: (loading) => set({ loading }),
  setLoadProgress: (loaded, total) => set({ loadProgress: { loaded, total } }),
  setError: (error, failedSong = null) => set({ error, failedSong }),
}));
