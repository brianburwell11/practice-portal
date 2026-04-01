import { createContext, useContext, useRef, useEffect } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { useTransportStore } from '../store/transportStore';

export const AudioEngineContext = createContext<AudioEngine | null>(null);

export function useAudioEngine(): AudioEngine {
  const engine = useContext(AudioEngineContext);
  if (!engine) throw new Error('useAudioEngine must be used within AudioEngineProvider');
  return engine;
}

// Module-level singleton so StrictMode double-mount doesn't destroy it
let singletonEngine: AudioEngine | null = null;

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
      setPosition(engine.clock.currentTime);
      setDuration(engine.clock.duration);
      // Sync loop state
      const { setLoopA, setLoopB, setLoopEnabled } = useTransportStore.getState();
      setLoopA(engine.loopA);
      setLoopB(engine.loopB);
      setLoopEnabled(engine.loopEnabled);
    });

    // Don't dispose — singleton survives StrictMode remounts
  }, [engine]);

  return engine;
}
