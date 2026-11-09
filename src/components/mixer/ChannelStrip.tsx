import { TouchSlider } from '../ui/TouchSlider';
import type { StemConfig } from '../../audio/types';
import { formatPan, useStemControls } from './useStemControls';
import { StemMuteSolo } from './MuteSoloButtons';
import { ResetIcon } from './ResetIcon';

/**
 * Empty stand-in for a slider row (the `TouchSlider` height), so stereo
 * stems and groups line up with mono stems, which have a Pan row.
 */
export function SliderRowSpacer() {
  return <div aria-hidden className="h-5 md:h-4" />;
}

interface ChannelStripProps {
  stemConfig: StemConfig;
}

/** A stem's horizontal mixer card (phones). Desktop uses `DesktopChannelStrip`. */
export function ChannelStrip({ stemConfig }: ChannelStripProps) {
  const c = useStemControls(stemConfig);
  if (!c) return null;
  const { stemState } = c;

  return (
    // Transparent border matches the group card's, so the heights line up.
    <div className="flex flex-col gap-2 p-3 bg-gray-800 rounded-lg min-w-[230px] border border-transparent">
      {/* Label with color indicator and stereo toggle */}
      <div className="flex items-center gap-2">
        {c.sourceChannels >= 2 ? (
          <button
            onClick={c.toggleStereo}
            className="shrink-0 flex items-center gap-0.5"
            title={stemState.stereo ? 'Stereo. Click for mono.' : 'Mono. Click for stereo.'}
            aria-label={`${stemConfig.label} stereo`}
            aria-pressed={stemState.stereo}
          >
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stemConfig.color }} />
            {stemState.stereo && (
              <div className="w-3 h-3 rounded-full -ml-1.5" style={{ backgroundColor: stemConfig.color, opacity: 0.7 }} />
            )}
          </button>
        ) : (
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stemConfig.color }} />
        )}
        <span className="text-sm font-medium text-gray-200 truncate">{stemConfig.label}</span>
        {!c.isAtDefaults && (
          <button
            onClick={c.reset}
            className="ml-auto shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
            title="Reset to defaults"
            aria-label={`Reset ${stemConfig.label} to defaults`}
          >
            <ResetIcon />
          </button>
        )}
      </div>

      {/* Volume slider */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 w-7">Vol</label>
        <TouchSlider min={0} max={1.5} step={0.01} value={stemState.volume} onChange={c.setVolume} label={`${stemConfig.label} volume`} className="flex-1" />
        <span className="text-xs text-gray-500 w-8 text-right font-mono">
          {Math.round(stemState.volume * 100)}
        </span>
      </div>

      {/* Pan slider — hidden in stereo mode, keeping its row so every card is the same height */}
      {stemState.stereo ? (
        <SliderRowSpacer />
      ) : (
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 w-7">Pan</label>
          <TouchSlider min={-1} max={1} step={0.01} value={stemState.pan} onChange={c.setPan} onDoubleClick={() => c.setPan(stemConfig.defaultPan)} label={`${stemConfig.label} pan`} className="flex-1" />
          <span className="text-xs text-gray-500 w-8 text-right font-mono">{formatPan(stemState.pan)}</span>
        </div>
      )}

      {/* Mute / Solo buttons */}
      <div className="flex gap-2">
        <StemMuteSolo
          label={stemConfig.label}
          muted={stemState.muted}
          soloed={stemState.soloed}
          globalMuteActive={c.globalMuteActive}
          globalSoloActive={c.globalSoloActive}
          onMute={c.toggleMute}
          onSolo={c.toggleSolo}
          buttonClassName="flex-1 text-xs py-1 min-h-[44px] md:min-h-0"
        />
      </div>
    </div>
  );
}
