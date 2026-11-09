import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { useBandStore } from '../../store/bandStore';
import { formatDb, parseDb } from '../../audio/db';
import { MAX_GAIN, VerticalFader } from './VerticalFader';
import { EditableReadout } from './EditableReadout';
import { NameBlock, StripFrame } from './DesktopChannelStrip';
import { textOn } from './textOn';

/** Fallback when a band has no accent color. */
const DEFAULT_ACCENT = '#3b82f6';

/**
 * The Master strip (desktop): name and volume only, in the band's accent
 * color. It drives the same master volume as the transport bar's Vol
 * slider, so the two stay in step. The empty slots keep its rows lined up
 * with the channel strips.
 */
export function DesktopMasterStrip() {
  const engine = useAudioEngine();
  const masterVolume = useMixerStore((s) => s.masterVolume);
  const setMasterVolume = useMixerStore((s) => s.setMasterVolume);
  const accent = useBandStore((s) => s.currentBand?.colors.accent) || DEFAULT_ACCENT;

  const setVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(MAX_GAIN, v));
    setMasterVolume(clamped);
    engine.setMasterVolume(clamped);
  };

  return (
    <StripFrame
      className="w-[76px] bg-gray-800 rounded-md"
      name={<NameBlock label="Master" />}
      nameStyle={{ backgroundColor: accent, color: textOn(accent) }}
      fader={(
        <VerticalFader
          value={masterVolume}
          onChange={setVolume}
          resetValue={1}
          color={accent}
          label="Master volume"
        />
      )}
      dbReadout={(
        <EditableReadout
          text={formatDb(masterVolume)}
          parse={(t) => parseDb(t, MAX_GAIN)}
          onCommit={setVolume}
          label="Master volume in dB"
        />
      )}
    />
  );
}
