import type { CSSProperties, ReactNode } from 'react';
import type { StemConfig } from '../../audio/types';
import { formatDb, parseDb } from '../../audio/db';
import { formatPan, parsePan, useStemControls } from './useStemControls';
import { StemMuteSolo } from './MuteSoloButtons';
import { PanKnob } from './PanKnob';
import { FaderScale, MAX_GAIN, VerticalFader } from './VerticalFader';
import { EditableReadout } from './EditableReadout';
import { ResetIcon } from './ResetIcon';
import { textOn } from './textOn';

/**
 * Background for a strip whose card starts at the band, leaving the name row
 * above it (pt-1 + h-5 + gap-1 = 1.75rem) blank and outside the card. Used
 * by tracks inside an open stack, whose names move into the band.
 */
export const CARD_BELOW_NAME = 'linear-gradient(to bottom, transparent 1.75rem, #1f2937 1.75rem)';

/** Classes the desktop M/S buttons share, stems and groups alike. */
export const STRIP_MS_BUTTON = 'flex-1 h-5 text-[11px] leading-none';

interface StripFrameProps {
  /** The pan knob, the stereo circles, or empty for a group. */
  knob?: ReactNode;
  /** Shown to the right of the knob. */
  panReadout?: ReactNode;
  fader?: ReactNode;
  dbReadout?: ReactNode;
  buttons?: ReactNode;
  /** Row under the name: a stack's `>`, or the reset button. */
  stackRow?: ReactNode;
  /** Paints the stack row as part of a track stack's band, in the stack's color. */
  bandColor?: string;
  /** The top name block's contents and color. Empty for tracks in an open stack, named in its band. */
  name?: ReactNode;
  nameStyle?: CSSProperties;
  className?: string;
  style?: CSSProperties;
}

/**
 * The fixed rows every desktop strip shares, top to bottom, so knobs,
 * faders and buttons line up across stems, stacks and the header column.
 */
export function StripFrame({
  knob, panReadout, fader, dbReadout, buttons, stackRow, bandColor, name, nameStyle,
  className = 'w-[76px] bg-gray-800 rounded-md', style,
}: StripFrameProps) {
  return (
    <div className={`flex flex-col items-center gap-1 shrink-0 h-full p-1 px-1.5 ${className}`} style={style}>
      <div
        className="h-5 w-full shrink-0 rounded-sm flex items-center justify-center px-1 text-[11px] font-medium"
        style={nameStyle}
      >
        {name}
      </div>
      {/* Bleeds past the strip's edges, over the 1px dividers, so an open
          stack's band runs unbroken across its tracks. */}
      <div
        className="h-4 w-[calc(100%+0.75rem+2px)] shrink-0 flex items-center justify-center"
        style={bandColor ? { backgroundColor: bandColor, color: textOn(bandColor) } : undefined}
      >
        {stackRow}
      </div>
      <div className="h-7 w-full flex items-center justify-center gap-0.5">
        {knob}
        {panReadout && (
          <div className="w-8 flex justify-center text-[10px] leading-none font-mono text-gray-400">{panReadout}</div>
        )}
      </div>
      <div className="flex-1 min-h-0 w-full flex justify-center">{fader}</div>
      <div className="h-3.5 w-full flex items-center justify-center text-[10px] leading-none font-mono text-gray-300">{dbReadout}</div>
      <div className="h-5 w-full flex items-center gap-1">{buttons}</div>
    </div>
  );
}

/** A colored name block, like Logic's. */
export function NameBlock({ label }: { label: string }) {
  return <span className="truncate" title={label}>{label}</span>;
}

/** Logic's row labels, in a column pinned to the mixer's left edge. */
export function StripHeader() {
  const label = (text: string) => (
    <span className="w-full text-right text-[10px] text-gray-500 whitespace-nowrap">{text}</span>
  );
  return (
    <StripFrame
      className="w-[84px] sticky left-0 z-10 bg-page"
      fader={<div className="flex h-full min-h-[100px] w-full justify-end"><FaderScale className="w-8" /></div>}
      knob={label('Pan')}
      dbReadout={label('dB')}
      buttons={label('Mute / Solo')}
      name={label('Name')}
    />
  );
}

interface DesktopChannelStripProps {
  stemConfig: StemConfig;
  /** Inside an open track stack: no top card, and the name in the stack's band. */
  stackColor?: string;
}

/** A stem's vertical, Logic-style channel strip (desktop). */
export function DesktopChannelStrip({ stemConfig, stackColor }: DesktopChannelStripProps) {
  const c = useStemControls(stemConfig);
  if (!c) return null;
  const { stemState } = c;
  const { label, color } = stemConfig;

  return (
    <StripFrame
      className={`w-[76px] ${stackColor ? '' : 'bg-gray-800 rounded-md'}`}
      style={stackColor ? { background: CARD_BELOW_NAME } : undefined}
      bandColor={stackColor}
      knob={stemState.stereo ? (
        <span className="flex items-center" title="Stereo" aria-label={`${label} is stereo`} role="img">
          <span className="block w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
          <span className="block w-4 h-4 rounded-full -ml-1.5" style={{ backgroundColor: color, opacity: 0.7 }} />
        </span>
      ) : (
        <PanKnob value={stemState.pan} onChange={c.setPan} resetValue={stemConfig.defaultPan} color={color} label={`${label} pan`} />
      )}
      panReadout={!stemState.stereo && (
        <EditableReadout
          text={formatPan(stemState.pan)}
          parse={parsePan}
          onCommit={c.setPan}
          label={`${label} pan`}
          inputClassName="w-8"
        />
      )}
      fader={(
        <VerticalFader
          value={stemState.volume}
          onChange={c.setVolume}
          resetValue={stemConfig.defaultVolume}
          color={color}
          label={`${label} volume`}
        />
      )}
      dbReadout={(
        <EditableReadout
          text={formatDb(stemState.volume)}
          parse={(t) => parseDb(t, MAX_GAIN)}
          onCommit={c.setVolume}
          label={`${label} volume in dB`}
        />
      )}
      buttons={(
        <StemMuteSolo
          label={label}
          muted={stemState.muted}
          soloed={stemState.soloed}
          globalMuteActive={c.globalMuteActive}
          globalSoloActive={c.globalSoloActive}
          onMute={c.toggleMute}
          onSolo={c.toggleSolo}
          buttonClassName={STRIP_MS_BUTTON}
        />
      )}
      stackRow={(
        <>
          {stackColor && (
            <span className="min-w-0 truncate px-1 text-[11px] font-medium leading-none" title={label}>{label}</span>
          )}
          {!c.isAtDefaults && (
            <button
              onClick={c.reset}
              className={`shrink-0 p-1 transition-colors ${stackColor ? 'opacity-70 hover:opacity-100' : 'text-gray-500 hover:text-gray-300'}`}
              title="Reset to defaults"
              aria-label={`Reset ${label} to defaults`}
            >
              <ResetIcon />
            </button>
          )}
        </>
      )}
      // In an open stack the name moves into the band, in the stack's color.
      name={!stackColor && <NameBlock label={label} />}
      nameStyle={stackColor ? undefined : { backgroundColor: color, color: textOn(color) }}
    />
  );
}
