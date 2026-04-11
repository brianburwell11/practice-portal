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
  globalSoloActive: boolean;
  globalMuteActive: boolean;
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
  toggleGlobalSolo: () => void;
  toggleGlobalMute: () => void;
  clearSoloGroup: () => void;
  clearMuteGroup: () => void;
}

export const useMixerStore = create<MixerState>((set) => ({
  masterVolume: 1,
  stems: {},
  groups: {},
  globalSoloActive: false,
  globalMuteActive: false,
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
    set((state) => {
      // If muting a new stem while global mute is inactive, clear old group and start fresh
      if (muted && !state.globalMuteActive) {
        const hasMuteGroup = Object.values(state.stems).some((s) => s.muted);
        if (hasMuteGroup) {
          const cleared: Record<string, StemMixState> = {};
          for (const [sid, s] of Object.entries(state.stems)) {
            cleared[sid] = { ...s, muted: sid === id };
          }
          return { stems: cleared, globalMuteActive: true };
        }
      }
      const stems = { ...state.stems, [id]: { ...state.stems[id], muted } };
      const anyMuted = Object.values(stems).some((s) => s.muted);
      return { stems, globalMuteActive: anyMuted ? true : state.globalMuteActive };
    }),
  setStemSoloed: (id, soloed) =>
    set((state) => {
      // If soloing a new stem while global solo is inactive, clear old group and start fresh
      if (soloed && !state.globalSoloActive) {
        const hasSoloGroup = Object.values(state.stems).some((s) => s.soloed);
        if (hasSoloGroup) {
          const cleared: Record<string, StemMixState> = {};
          for (const [sid, s] of Object.entries(state.stems)) {
            cleared[sid] = { ...s, soloed: sid === id };
          }
          return { stems: cleared, globalSoloActive: true };
        }
      }
      const stems = { ...state.stems, [id]: { ...state.stems[id], soloed } };
      const anySoloed = Object.values(stems).some((s) => s.soloed);
      return { stems, globalSoloActive: anySoloed ? true : state.globalSoloActive };
    }),
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
  toggleGlobalSolo: () =>
    set((state) => ({ globalSoloActive: !state.globalSoloActive })),
  toggleGlobalMute: () =>
    set((state) => ({ globalMuteActive: !state.globalMuteActive })),
  clearSoloGroup: () =>
    set((state) => {
      const stems: Record<string, StemMixState> = {};
      for (const [id, s] of Object.entries(state.stems)) {
        stems[id] = { ...s, soloed: false };
      }
      return { stems, globalSoloActive: false };
    }),
  clearMuteGroup: () =>
    set((state) => {
      const stems: Record<string, StemMixState> = {};
      for (const [id, s] of Object.entries(state.stems)) {
        stems[id] = { ...s, muted: false };
      }
      return { stems, globalMuteActive: false };
    }),
}));
