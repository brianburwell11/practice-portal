import type { TapMapEntry } from './types';

/** Format seconds as `H:MM:SS.ffffff` (microsecond precision). */
export function formatXscTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const wholeSec = Math.floor(s % 60);
  const micros = Math.round((s - Math.floor(s)) * 1_000_000);
  return `${h}:${m.toString().padStart(2, '0')}:${wholeSec
    .toString()
    .padStart(2, '0')}.${micros.toString().padStart(6, '0')}`;
}

/** Format SaveDate as `YYYY-MM-DD HH:MM` matching Transcribe!'s format. */
function formatSaveDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// Copied verbatim from /Users/brianburwell/Downloads/THE SHAPE MIX 2.xsc
// (lines 21–68). These values are Transcribe!'s runtime view state;
// emitting the reference values is faithful enough for our purposes.
const VIEW0_BLOCK = `SectionStart,View0
FX_Mix,0,0,100,0
FX_Tuning,1,1,0,0,0,0,60,50,0
FX_Transposition,1,1,0,0,0
FX_EQ,1,0,0,0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0
FX_Speed,1,0,100000,0
FX_Misc,1,0,50,0,80,0
ShowTextZone,0
ShowPianoRoll,0
PianoRollPiano,1
PianoRollSensitivity,3
ShowVideo,1
SelectSoundTrack,0
SelectSubtitles,-2
ShowSubtitles,0
TVVVideoSizeLinear,500
TVVVtimeOffset,0.000000
TVVVideoMirror,0
TVVVideoVFlip,0
ShowNavbar,0
NavBarMeasures,1
NavBarMeasuresMenu,1
ShowSpectrum,0
ShowGuessNotes,0
ShowGuessChords,0
ShowAsMono,0
ShowDB,0
ShowTimeLine,0
ShowLoopLine,0
FitWholeFile,0
FitWholeFileHorizZoom,1.000000
FitWholeFileStartwavpix,-1
LoopMode,1
LoopDelayMode,1
ScrollMode,1
PianoBtmNote,24
PianoTopNote,96
PianoRollBtmNote,24
PianoRollTopNote,96
TextZoneSplitterPos,0.250000
PianoRollSplitterPos,0.500000
ViewSplitterPos,0.701105
VertProfileZoom,1.000000
HorizProfileZoom,0.125000
HorizProfilePos,485
SelectionLeft,0,0:00:00.000000
SelectionRight,0,0:00:00.000000
SectionEnd,View0`;

const LOOPS_BLOCK = (() => {
  const lines: string[] = ['SectionStart,Loops', 'Howmany,20'];
  for (let i = 1; i <= 20; i++) {
    lines.push(`L,${i},0,0,0,,White,,0:00:00.000000,0:00:00.000000`);
  }
  lines.push('SectionEnd,Loops');
  return lines.join('\n');
})();

function markerLine(entry: TapMapEntry): string {
  const ts = formatXscTimestamp(entry.time);
  if (entry.type === 'section') {
    return `S,-1,0,${entry.label ?? ''},0,${ts}`;
  }
  if (entry.type === 'measure') {
    return `M,-1,1,,0,${ts}`;
  }
  return `B,-1,1,,0,${ts}`;
}

export interface XscWavInfo {
  /** Number of audio frames (samples per channel). */
  frameCount: number;
  channels: number;
  sampleRate: number;
  /** Duration in seconds (float). */
  durationSeconds: number;
  /** Total file size in bytes, including the 44-byte WAV header. */
  totalBytes: number;
  /** Bits per sample (e.g. 16). */
  bitsPerSample: number;
}

/**
 * Build the full text of a Transcribe!-compatible .xsc document that
 * references `wavFileName` as the sound source and embeds the given
 * tapMap as Markers.
 */
export function buildXscContent(
  tapMap: TapMapEntry[],
  opts: { wavFileName: string; wavInfo: XscWavInfo; now?: Date },
): string {
  const { wavFileName, wavInfo } = opts;
  const now = opts.now ?? new Date();

  const main = [
    'SectionStart,Main',
    `SaveDate,${formatSaveDate(now)}`,
    'WindowSize,654|33|858|949,0',
    'ViewList,1,0,0.00000000',
    `SoundFileName,${wavFileName},MacOSX,${wavFileName}`,
    `SoundFileInfo,Wave Audio Data File WAV (Microsoft),${wavInfo.bitsPerSample} bit PCM,${wavInfo.channels},${wavInfo.totalBytes},${wavInfo.sampleRate},${wavInfo.frameCount},${wavInfo.durationSeconds.toFixed(8)}`,
    'SubtitleFileName,,MacOSX,/Applications/',
    'SubtitleFontSize,15',
    'SubtitleBackgroundRectangle,0',
    'SynchronizeViews,1',
    'Loops,0:0,0:0,0:0,0:0,0:0,0:0,0:0,0:0,0:0,0:0',
    'MarkerNumberContinuously,0',
    'MarkerAutoSection,0',
    'MarkerAutoMeasure,0',
    'MarkerAutoBeat,1',
    'SectionEnd,Main',
  ].join('\n');

  const markers = [
    'SectionStart,Markers',
    `Howmany,${tapMap.length}`,
    ...tapMap.map(markerLine),
    'SectionEnd,Markers',
  ].join('\n');

  const textBlocks = [
    'SectionStart,TextBlocks',
    'TextBlockFont,80,12,,',
    'Howmany,0',
    'SectionEnd,TextBlocks',
  ].join('\n');

  const separateStems = [
    'SectionStart,SeparateStemFiles',
    'ShowStemSelector,0',
    `StemFile,${wavFileName},Stem 1,${wavFileName}`,
    'SectionEnd,SeparateStemFiles',
  ].join('\n');

  return [
    'Transcribe! for Macintosh document. Version 6089.00',
    'Transcribe!,Macintosh OS-X,9,30,7,S,2',
    '',
    main,
    '',
    VIEW0_BLOCK,
    '',
    markers,
    '',
    textBlocks,
    '',
    LOOPS_BLOCK,
    '',
    separateStems,
    '',
  ].join('\n');
}
