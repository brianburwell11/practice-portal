import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import type { StemConfig } from '../../audio/types';

/**
 * One stem's mixer state and the handlers that change it in both the store
 * and the audio engine. Shared by the mobile card and the desktop strip.
 * Returns null until the stem's mixer state exists.
 */
export function useStemControls(stemConfig: StemConfig) {
  const engine = useAudioEngine();
  const stemState = useMixerStore((s) => s.stems[stemConfig.id]);
  const globalSoloActive = useMixerStore((s) => s.globalSoloActive);
  const globalMuteActive = useMixerStore((s) => s.globalMuteActive);
  const { setStemVolume, setStemPan, setStemMuted, setStemSoloed, setStemStereo } = useMixerStore();
  const sourceChannels = engine.getStem(stemConfig.id)?.sourceChannels ?? 1;

  if (!stemState) return null;

  const setVolume = (v: number) => {
    setStemVolume(stemConfig.id, v);
    engine.setStemVolume(stemConfig.id, v);
  };

  const setPan = (v: number) => {
    setStemPan(stemConfig.id, v);
    engine.setStemPan(stemConfig.id, v);
  };

  const toggleMute = () => {
    const muted = !stemState.muted;
    setStemMuted(stemConfig.id, muted);
    engine.setStemMuted(stemConfig.id, muted);
  };

  const toggleSolo = () => {
    const soloed = !stemState.soloed;
    setStemSoloed(stemConfig.id, soloed);
    engine.setStemSoloed(stemConfig.id, soloed);
  };

  const toggleStereo = () => {
    const stereo = !stemState.stereo;
    setStemStereo(stemConfig.id, stereo);
    engine.setStemStereo(stemConfig.id, stereo);
  };

  const reset = () => {
    setVolume(stemConfig.defaultVolume);
    setPan(stemConfig.defaultPan);
    if (stemState.muted) toggleMute();
    if (stemState.soloed) toggleSolo();
  };

  const isAtDefaults =
    Math.abs(stemState.volume - stemConfig.defaultVolume) < 0.001 &&
    Math.abs(stemState.pan - stemConfig.defaultPan) < 0.001 &&
    !stemState.muted &&
    !stemState.soloed;

  return {
    stemState, globalSoloActive, globalMuteActive, sourceChannels, isAtDefaults,
    setVolume, setPan, toggleMute, toggleSolo, toggleStereo, reset,
  };
}

/** Pan as Logic shows it: `C`, `L42`, `R18`. */
export function formatPan(pan: number): string {
  if (pan === 0) return 'C';
  return pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`;
}

/**
 * Typed pan as -1 to 1, or null if it isn't one. Accepts what `formatPan`
 * shows (`C`, `L42`, `R18`), words (`center`, `left 30`), and plain numbers
 * from -100 (left) to 100 (right). Clamped to the range.
 */
export function parsePan(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === 'c' || t === 'center' || t === 'centre') return 0;
  const m = /^(l|left|r|right)?\s*([+-]?\d+\.?\d*)$/.exec(t);
  if (!m) return null;
  let n = Number(m[2]);
  if (m[1]?.startsWith('l')) n = -Math.abs(n);
  else if (m[1]?.startsWith('r')) n = Math.abs(n);
  return Math.max(-1, Math.min(1, Math.round(n) / 100));
}
