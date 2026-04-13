import type { TapMapEntry, StemGroupConfig } from '../audio/types';
import type { UploadProgress } from './utils/uploadWithProgress';
import { deriveId } from '../utils/deriveId';

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
  step: 1 | 2 | 3 | 4 | 5;
  // Step 1: Metadata
  title: string;
  artist: string;
  key: string;
  id: string;
  // Step 2: Stems & Groups
  stems: StemEntry[];
  durationSeconds: number;
  groups: StemGroupConfig[];
  // Step 3: Timing
  timingMode: 'xsc' | 'manual' | null;
  tapMap: TapMapEntry[];
  manualBpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  // Step 4: Save
  saving: boolean;
  error: string | null;
  uploadProgress: UploadProgress | null;
}

export type WizardAction =
  | { type: 'SET_TITLE'; title: string; fallbackArtist?: string }
  | { type: 'SET_ARTIST'; artist: string; fallbackArtist?: string }
  | { type: 'SET_KEY'; key: string }
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
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_UPLOAD_PROGRESS'; progress: UploadProgress | null };

export const initialState: WizardState = {
  step: 1,
  title: '',
  artist: '',
  key: '',
  id: '',
  stems: [],
  durationSeconds: 0,
  timingMode: null,
  tapMap: [],
  manualBpm: 120,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  groups: [],
  saving: false,
  error: null,
  uploadProgress: null,
};

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_TITLE':
      return { ...state, title: action.title, id: deriveId(action.title, state.artist || action.fallbackArtist || '') };
    case 'SET_ARTIST':
      return { ...state, artist: action.artist, id: deriveId(state.title, action.artist || action.fallbackArtist || '') };
    case 'SET_KEY':
      return { ...state, key: action.key };
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
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, 5) as WizardState['step'] };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 1) as WizardState['step'] };
    case 'SET_SAVING':
      return { ...state, saving: action.saving };
    case 'SET_ERROR':
      return { ...state, error: action.error, uploadProgress: null };
    case 'SET_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.progress };
  }
}
