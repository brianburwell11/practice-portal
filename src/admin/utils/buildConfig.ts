import type { SongConfig, MarkerConfig } from '../../audio/types';
import type { WizardState } from '../wizardReducer';
import { deduplicateLabels } from './stemDetection';
import { slugify } from '../../utils/deriveId';

const markerColors = [
  '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#ef4444',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export function buildConfig(state: WizardState, fallbackArtist?: string): SongConfig {
  // Dedupe collisions before deriving ids so two stems sharing a label don't
  // slug to the same id in the saved config.
  const dedupedStems = deduplicateLabels(state.stems);
  const stems = dedupedStems.map((s) => ({
    id: s.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || s.id,
    label: s.label,
    file: s.file.name,
    defaultVolume: s.defaultVolume,
    defaultPan: s.defaultPan,
    color: s.color,
    ...(s.stereo ? { stereo: true } : {}),
    ...(s.offsetSec ? { offsetSec: s.offsetSec } : {}),
  }));

  // Groups capture stem ids at the moment of group creation, but the saved
  // stem ids are re-derived from labels above. Map the stored ids to the
  // final ids so renamed stems don't drop out of their group.
  const idMap = new Map<string, string>();
  state.stems.forEach((original, i) => {
    if (stems[i]) idMap.set(original.id, stems[i].id);
  });
  const remappedGroups = state.groups.map((g) => ({
    ...g,
    stemIds: g.stemIds.map((id) => idMap.get(id) ?? id),
  }));

  // Mixer order also references stem ids; remap and drop ids that
  // are no longer valid (e.g. a removed stem still listed) so the
  // saved config stays clean.
  const validIds = new Set<string>([
    ...stems.map((s) => s.id),
    ...remappedGroups.map((g) => g.id),
  ]);
  const remappedMixerOrder = state.mixerOrder
    .map((id) => idMap.get(id) ?? id)
    .filter((id) => validIds.has(id));

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

  const finalSlug = slugify(state.slug);
  return {
    id: state.id,
    ...(finalSlug ? { slug: finalSlug } : {}),
    title: state.title,
    artist: state.artist.trim() || fallbackArtist || '',
    key: state.key,
    durationSeconds,
    beatOffset: 0,
    stems,
    groups: remappedGroups.length > 0 ? remappedGroups : undefined,
    ...(remappedMixerOrder.length > 0 ? { mixerOrder: remappedMixerOrder } : {}),
    tempoMap,
    timeSignatureMap,
    metronome: {
      clickSound: 'woodblock',
      accentPattern,
      subdivisions: 1,
    },
    markers,
    tapMap: state.tapMap.length > 0 ? state.tapMap : undefined,
    ...(state.tags.length > 0 ? { tags: state.tags } : {}),
    // Only persist the D.C./D.S. repeat toggle when both (a) sheet
    // music was staged — the flag is meaningless otherwise — and
    // (b) the admin actually turned it on.
    ...(state.sheetMusicFile && state.repeatAfterDcDs ? { repeatAfterDcDs: true } : {}),
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
