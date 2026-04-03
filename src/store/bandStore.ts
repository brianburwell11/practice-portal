import { create } from 'zustand';
import type { BandConfig, BandsManifest } from '../audio/types';

interface BandState {
  bandsManifest: BandsManifest | null;
  currentBand: BandConfig | null;
  setBandsManifest: (m: BandsManifest) => void;
  setCurrentBand: (b: BandConfig | null) => void;
}

export const useBandStore = create<BandState>((set) => ({
  bandsManifest: null,
  currentBand: null,
  setBandsManifest: (bandsManifest) => set({ bandsManifest }),
  setCurrentBand: (currentBand) => set({ currentBand }),
}));
