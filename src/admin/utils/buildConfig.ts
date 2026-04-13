import type { SongConfig, MarkerConfig } from '../../audio/types';
import type { WizardState } from '../wizardReducer';

const markerColors = [
  '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export function buildConfig(state: WizardState, fallbackArtist?: string): SongConfig {
  const stems = state.stems.map((s) => ({
    id: s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.id,
    label: s.label,
    file: s.file.name,
    defaultVolume: s.defaultVolume,
    defaultPan: s.defaultPan,
    color: s.color,
    ...(s.stereo ? { stereo: true } : {}),
  }));

  // Tempo map
  const bpm = state.timingMode === 'manual' ? state.manualBpm : 120;
  const tempoMap = [{ beat: 0, bpm }];

  // Time signature
  const numerator = state.timingMode === 'manual' ? state.timeSignatureNumerator : 4;
  const denominator = state.timingMode === 'manual' ? state.timeSignatureDenominator : 4;
  const timeSignatureMap = [{ beat: 0, numerator, denominator }];

  // Accent pattern based on time signature
  const accentPattern = buildAccentPattern(numerator);

  // Markers from XSC sections
  const markers: MarkerConfig[] = [];
  if (state.timingMode === 'xsc') {
    const sections = state.tapMap.filter((e) => e.type === 'section' && e.label);
    sections.forEach((section, i) => {
      const beat = section.time * (bpm / 60);
      markers.push({
        name: section.label!,
        beat: Math.round(beat * 100) / 100,
        color: markerColors[i % markerColors.length],
      });
    });
  }

  // Duration must span the aligned mix: positive offsets extend a stem
  // past its original length, so the song duration has to reflect that
  // or the player's clock ceiling will truncate the tail.
  const alignedEnd = state.stems.reduce((max, s) => {
    const dur = s.buffer?.duration;
    if (dur === undefined) return max;
    return Math.max(max, s.offsetSec + dur);
  }, 0);
  const durationSeconds = Math.max(state.durationSeconds, alignedEnd);

  return {
    id: state.id,
    title: state.title,
    artist: state.artist.trim() || fallbackArtist || '',
    key: state.key,
    durationSeconds,
    beatOffset: 0,
    stems,
    groups: state.groups.length > 0 ? state.groups : undefined,
    tempoMap,
    timeSignatureMap,
    metronome: {
      clickSound: 'woodblock',
      accentPattern,
      subdivisions: 1,
    },
    markers,
    tapMap: state.tapMap.length > 0 ? state.tapMap : undefined,
  };
}

function buildAccentPattern(numerator: number): number[] {
  if (numerator === 3) return [1.0, 0.4, 0.4];
  if (numerator === 6) return [1.0, 0.3, 0.3, 0.7, 0.3, 0.3];
  if (numerator === 5) return [1.0, 0.4, 0.6, 0.4, 0.4];
  if (numerator === 7) return [1.0, 0.3, 0.3, 0.7, 0.3, 0.7, 0.3];
  // Default 4/4
  const pattern = Array(numerator).fill(0.4);
  pattern[0] = 1.0;
  if (numerator >= 3) pattern[2] = 0.6;
  return pattern;
}
