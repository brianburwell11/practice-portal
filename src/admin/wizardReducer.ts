import type { TapMapEntry, StemGroupConfig } from '../audio/types';
import type { UploadProgress } from './utils/uploadWithProgress';
import { slugify, cleanSlugInput } from '../utils/deriveId';
import { dedupeSlug } from '../utils/dedupeSlug';
import { generateId } from '../utils/generateId';

export interface StemEntry {
  file: File;
  id: string;
  label: string;
  color: string;
  defaultVolume: number;
  defaultPan: number;
  channels: number;
  stereo: boolean;
  offsetSec: number;
  /** Decoded buffer cached at upload time — used by the alignment step for peaks + playback. */
  buffer?: AudioBuffer;
}

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  // Step 1: Metadata
  title: string;
  artist: string;
  key: string;
  /** Opaque random id (base62, 7 chars). Generated once on wizard init
   *  and immutable for the life of the wizard. */
  id: string;
  /** Kebab-case URL segment. Auto-derived from title until the admin
   *  manually edits it (then `slugEdited` pins it). */
  slug: string;
  slugEdited: boolean;
  tags: string[];
  // Step 2: Stems & Groups
  stems: StemEntry[];
  durationSeconds: number;
  groups: StemGroupConfig[];
  /** Top-level mixer order: group IDs and ungrouped stem IDs. May be
   *  partial / out of sync with stems+groups; `resolveMixerOrder`
   *  reconciles at render time, so the reducer is forgiving. */
  mixerOrder: string[];
  // Step 3: Timing
  timingMode: 'xsc' | 'manual' | null;
  tapMap: TapMapEntry[];
  manualBpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  // Optional sheet music (MusicXML / MXL). Uploaded in ReviewStep after
  // the stem transcode-upload succeeds; `sheetMusicUrl` is injected into
  // the saved config using the file's canonical name (`score.{ext}`).
  sheetMusicFile: File | null;
  // When true, internal repeats / voltas are re-taken on the return
  // pass after D.C. / D.S. Only persisted when `sheetMusicFile` is
  // set (ignored otherwise).
  repeatAfterDcDs: boolean;
  // Step 4: Save
  saving: boolean;
  error: string | null;
  uploadProgress: UploadProgress | null;
}

export type WizardAction =
  | { type: 'SET_TITLE'; title: string; fallbackArtist?: string; takenSlugs?: Iterable<string> }
  | { type: 'SET_ARTIST'; artist: string; fallbackArtist?: string }
  | { type: 'SET_KEY'; key: string }
  | { type: 'SET_SLUG'; slug: string }
  | { type: 'SET_TAGS'; tags: string[] }
  | { type: 'SET_STEMS'; stems: StemEntry[]; durationSeconds: number }
  | { type: 'UPDATE_STEM'; index: number; updates: Partial<Omit<StemEntry, 'file'>> }
  | { type: 'REMOVE_STEM'; index: number }
  | { type: 'MOVE_STEM'; from: number; to: number }
  | { type: 'SET_STEM_OFFSET'; index: number; offsetSec: number }
  | { type: 'SET_TIMING_XSC'; tapMap: TapMapEntry[] }
  | { type: 'SET_TIMING_MANUAL'; bpm: number; numerator: number; denominator: number }
  | { type: 'CLEAR_TIMING' }
  | { type: 'ADD_GROUP'; group: StemGroupConfig }
  | { type: 'REMOVE_GROUP'; index: number }
  | { type: 'SET_MIXER_ORDER'; order: string[] }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_UPLOAD_PROGRESS'; progress: UploadProgress | null }
  | { type: 'SET_SHEET_MUSIC_FILE'; file: File | null }
  | { type: 'SET_REPEAT_AFTER_DC_DS'; value: boolean };

export function createInitialState(): WizardState {
  return {
    step: 1,
    title: '',
    artist: '',
    key: '',
    id: generateId(),
    slug: '',
    slugEdited: false,
    tags: [],
    stems: [],
    durationSeconds: 0,
    timingMode: null,
    tapMap: [],
    manualBpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    groups: [],
    mixerOrder: [],
    sheetMusicFile: null,
    repeatAfterDcDs: false,
    saving: false,
    error: null,
    uploadProgress: null,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_TITLE':
      return {
        ...state,
        title: action.title,
        slug: state.slugEdited
          ? state.slug
          : dedupeSlug(slugify(action.title), action.takenSlugs ?? []),
      };
    case 'SET_ARTIST':
      return { ...state, artist: action.artist };
    case 'SET_KEY':
      return { ...state, key: action.key };
    case 'SET_SLUG':
      return { ...state, slug: cleanSlugInput(action.slug), slugEdited: true };
    case 'SET_TAGS':
      return { ...state, tags: action.tags };
    case 'SET_STEMS':
      return { ...state, stems: action.stems, durationSeconds: action.durationSeconds };
    case 'UPDATE_STEM': {
      const stems = state.stems.map((s, i) =>
        i === action.index ? { ...s, ...action.updates } : s,
      );
      return { ...state, stems };
    }
    case 'REMOVE_STEM':
      return { ...state, stems: state.stems.filter((_, i) => i !== action.index) };
    case 'MOVE_STEM': {
      const stems = [...state.stems];
      const [moved] = stems.splice(action.from, 1);
      stems.splice(action.to, 0, moved);
      return { ...state, stems };
    }
    case 'SET_STEM_OFFSET': {
      const stems = state.stems.map((s, i) =>
        i === action.index ? { ...s, offsetSec: action.offsetSec } : s,
      );
      return { ...state, stems };
    }
    case 'SET_TIMING_XSC':
      return { ...state, timingMode: 'xsc', tapMap: action.tapMap };
    case 'SET_TIMING_MANUAL':
      return {
        ...state,
        timingMode: 'manual',
        manualBpm: action.bpm,
        timeSignatureNumerator: action.numerator,
        timeSignatureDenominator: action.denominator,
      };
    case 'CLEAR_TIMING':
      return { ...state, timingMode: null, tapMap: [] };
    case 'ADD_GROUP':
      return { ...state, groups: [...state.groups, action.group] };
    case 'REMOVE_GROUP':
      return { ...state, groups: state.groups.filter((_, i) => i !== action.index) };
    case 'SET_MIXER_ORDER':
      return { ...state, mixerOrder: action.order };
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, 4) as WizardState['step'] };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 1) as WizardState['step'] };
    case 'SET_SAVING':
      return { ...state, saving: action.saving };
    case 'SET_ERROR':
      return { ...state, error: action.error, uploadProgress: null };
    case 'SET_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.progress };
    case 'SET_SHEET_MUSIC_FILE':
      return { ...state, sheetMusicFile: action.file };
    case 'SET_REPEAT_AFTER_DC_DS':
      return { ...state, repeatAfterDcDs: action.value };
  }
}
