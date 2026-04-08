import { create } from 'zustand';

export interface StemMixState {
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  stereo: boolean;
}

export interface GroupMixState {
  volume: number;
  muted: boolean;
  soloed: boolean;
  expanded: boolean;
}

interface MixerState {
  masterVolume: number;
  stems: Record<string, StemMixState>;
  groups: Record<string, GroupMixState>;
  setMasterVolume: (v: number) => void;
  initStems: (stems: Record<string, StemMixState>) => void;
  initGroups: (groups: Record<string, GroupMixState>) => void;
  setStemVolume: (id: string, v: number) => void;
  setStemPan: (id: string, v: number) => void;
  setStemMuted: (id: string, m: boolean) => void;
  setStemSoloed: (id: string, s: boolean) => void;
  setStemStereo: (id: string, s: boolean) => void;
  setGroupVolume: (id: string, v: number) => void;
  setGroupMuted: (id: string, m: boolean) => void;
  setGroupSoloed: (id: string, s: boolean) => void;
  toggleGroupExpanded: (id: string) => void;
}

export const useMixerStore = create<MixerState>((set) => ({
  masterVolume: 1,
  stems: {},
  groups: {},
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  initStems: (stems) => set({ stems }),
  initGroups: (groups) => set({ groups }),
  setStemVolume: (id, volume) =>
    set((state) => ({
      stems: { ...state.stems, [id]: { ...state.stems[id], volume } },
    })),
  setStemPan: (id, pan) =>
    set((state) => ({
      stems: { ...state.stems, [id]: { ...state.stems[id], pan } },
    })),
  setStemMuted: (id, muted) =>
    set((state) => ({
      stems: { ...state.stems, [id]: { ...state.stems[id], muted } },
    })),
  setStemSoloed: (id, soloed) =>
    set((state) => ({
      stems: { ...state.stems, [id]: { ...state.stems[id], soloed } },
    })),
  setStemStereo: (id, stereo) =>
    set((state) => ({
      stems: { ...state.stems, [id]: { ...state.stems[id], stereo } },
    })),
  setGroupVolume: (id, volume) =>
    set((state) => ({
      groups: { ...state.groups, [id]: { ...state.groups[id], volume } },
    })),
  setGroupMuted: (id, muted) =>
    set((state) => ({
      groups: { ...state.groups, [id]: { ...state.groups[id], muted } },
    })),
  setGroupSoloed: (id, soloed) =>
    set((state) => ({
      groups: { ...state.groups, [id]: { ...state.groups[id], soloed } },
    })),
  toggleGroupExpanded: (id) =>
    set((state) => ({
      groups: {
        ...state.groups,
        [id]: { ...state.groups[id], expanded: !state.groups[id].expanded },
      },
    })),
}));
