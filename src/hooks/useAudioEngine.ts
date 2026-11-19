import { createContext, useContext, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { useTransportStore } from '../store/transportStore';
import { useLatencyStore } from '../store/latencyStore';

export const AudioEngineContext = createContext<AudioEngine | null>(null);

export function useAudioEngine(): AudioEngine {
  const engine = useContext(AudioEngineContext);
  if (!engine) throw new Error('useAudioEngine must be used within AudioEngineProvider');
  return engine;
}

// Module-level singleton so StrictMode double-mount doesn't destroy it
let singletonEngine: AudioEngine | null = null;

/** Stop the shared engine, if there is one. For when the page leaves a band. */
export function stopSharedEngine(): void {
  singletonEngine?.stop();
}

export function useCreateEngine(): AudioEngine {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) {
    if (!singletonEngine) {
      singletonEngine = new AudioEngine();
    }
    engineRef.current = singletonEngine;
  }

  const engine = engineRef.current;

  useEffect(() => {
    const { setPlaying, setPosition, setDuration } = useTransportStore.getState();

    engine.setOnStateChange(() => {
      setPlaying(engine.clock.playing);
      // What the listener hears, so visuals line up on Bluetooth headphones too
      setPosition(engine.clock.audibleTime);
      setDuration(engine.clock.duration);
      // Sync loop state
      const { setLoopA, setLoopB, setLoopEnabled } = useTransportStore.getState();
      setLoopA(engine.loopA);
      setLoopB(engine.loopB);
      setLoopEnabled(engine.loopEnabled);
      useTransportStore.getState().setPeaksVersion(engine.peaksVersion);
    });

    // Don't dispose — singleton survives StrictMode remounts
  }, [engine]);

  useEffect(() => {
    engine.setLatencyAdjustMs(useLatencyStore.getState().adjustMs);
    return useLatencyStore.subscribe((s) => engine.setLatencyAdjustMs(s.adjustMs));
  }, [engine]);

  return engine;
}
