import { create } from 'zustand';

interface TransportState {
  playing: boolean;
  position: number;
  duration: number;
  setPlaying: (p: boolean) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  position: 0,
  duration: 0,
  setPlaying: (playing) => set({ playing }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
}));
