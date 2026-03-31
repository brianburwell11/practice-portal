import { create } from 'zustand';

interface TransportState {
  playing: boolean;
  position: number;
  duration: number;
  tempoRatio: number;
  loopA: number | null;
  loopB: number | null;
  setPlaying: (p: boolean) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
  setTempoRatio: (r: number) => void;
  setLoopA: (a: number | null) => void;
  setLoopB: (b: number | null) => void;
  clearLoop: () => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  playing: false,
  position: 0,
  duration: 0,
  tempoRatio: 1.0,
  loopA: null,
  loopB: null,
  setPlaying: (playing) => set({ playing }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setTempoRatio: (tempoRatio) => set({ tempoRatio }),
  setLoopA: (loopA) => set({ loopA }),
  setLoopB: (loopB) => set({ loopB }),
  clearLoop: () => set({ loopA: null, loopB: null }),
}));
