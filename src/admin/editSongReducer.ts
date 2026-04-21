import type { SongConfig, StemConfig, StemGroupConfig, NavLinkConfig } from '../audio/types';
import type { UploadProgress } from './utils/uploadWithProgress';
import { deriveId } from '../utils/deriveId';

export interface EditSongState {
  config: SongConfig | null;
  original: SongConfig | null;
  saving: boolean;
  error: string | null;
  saveSuccess: boolean;
  uploadProgress: UploadProgress | null;
}

export type EditSongAction =
  | { type: 'INIT'; config: SongConfig }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_ARTIST'; artist: string }
  | { type: 'SET_KEY'; key: string }
  | { type: 'UPDATE_STEM'; index: number; updates: Partial<StemConfig> }
  | { type: 'REMOVE_STEM'; index: number }
  | { type: 'MOVE_STEM'; from: number; to: number }
  | { type: 'ADD_STEM'; stem: StemConfig }
  | { type: 'ADD_GROUP'; group: StemGroupConfig }
  | { type: 'REMOVE_GROUP'; index: number }
  | { type: 'ADD_NAV_LINK'; link: NavLinkConfig }
  | { type: 'UPDATE_NAV_LINK'; index: number; link: NavLinkConfig }
  | { type: 'REMOVE_NAV_LINK'; index: number }
  | { type: 'MOVE_NAV_LINK'; from: number; to: number }
  | { type: 'SET_TAGS'; tags: string[] }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_SAVE_SUCCESS' }
  | { type: 'RESET_DIRTY' }
  | { type: 'SET_UPLOAD_PROGRESS'; progress: UploadProgress | null }
  | { type: 'SET_SHEET_MUSIC_URL'; url: string | undefined }
  | { type: 'SET_REPEAT_AFTER_DC_DS'; value: boolean };

export const initialEditState: EditSongState = {
  config: null,
  original: null,
  saving: false,
  error: null,
  saveSuccess: false,
  uploadProgress: null,
};

export function isDirty(state: EditSongState): boolean {
  return JSON.stringify(state.config) !== JSON.stringify(state.original);
}

function updateConfig(state: EditSongState, patch: Partial<SongConfig>): EditSongState {
  if (!state.config) return state;
  return { ...state, config: { ...state.config, ...patch }, saveSuccess: false };
}

export function editSongReducer(state: EditSongState, action: EditSongAction): EditSongState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        config: structuredClone(action.config),
        original: structuredClone(action.config),
        error: null,
        saveSuccess: false,
      };

    case 'SET_TITLE':
      return updateConfig(state, {
        title: action.title,
        id: deriveId(action.title, state.config!.artist),
      });
    case 'SET_ARTIST':
      return updateConfig(state, {
        artist: action.artist,
        id: deriveId(state.config!.title, action.artist),
      });
    case 'SET_KEY':
      return updateConfig(state, { key: action.key });

    case 'UPDATE_STEM': {
      if (!state.config) return state;
      const prev = state.config.stems[action.index];
      const stems = state.config.stems.map((s, i) =>
        i === action.index ? { ...s, ...action.updates } : s,
      );
      // If the id changed, rename it in any group that references it so the
      // group doesn't hold a stale pointer to the old id.
      const nextId = action.updates.id;
      const renamed = prev && nextId && prev.id !== nextId;
      const groups = renamed
        ? (state.config.groups ?? []).map((g) => ({
            ...g,
            stemIds: g.stemIds.map((id) => (id === prev.id ? nextId : id)),
          }))
        : state.config.groups;
      return updateConfig(state, { stems, groups });
    }

    case 'REMOVE_STEM': {
      if (!state.config) return state;
      const removedId = state.config.stems[action.index]?.id;
      const stems = state.config.stems.filter((_, i) => i !== action.index);
      // Clean up group references
      const groups = (state.config.groups ?? [])
        .map((g) => ({ ...g, stemIds: g.stemIds.filter((id) => id !== removedId) }))
        .filter((g) => g.stemIds.length > 0);
      return updateConfig(state, { stems, groups });
    }

    case 'MOVE_STEM': {
      if (!state.config) return state;
      const stems = [...state.config.stems];
      const [moved] = stems.splice(action.from, 1);
      stems.splice(action.to, 0, moved);
      return updateConfig(state, { stems });
    }

    case 'ADD_STEM':
      if (!state.config) return state;
      return updateConfig(state, { stems: [...state.config.stems, action.stem] });

    case 'ADD_GROUP':
      if (!state.config) return state;
      return updateConfig(state, { groups: [...(state.config.groups ?? []), action.group] });

    case 'REMOVE_GROUP':
      if (!state.config) return state;
      return updateConfig(state, {
        groups: (state.config.groups ?? []).filter((_, i) => i !== action.index),
      });

    case 'ADD_NAV_LINK':
      if (!state.config) return state;
      return updateConfig(state, { navLinks: [...(state.config.navLinks ?? []), action.link] });

    case 'UPDATE_NAV_LINK':
      if (!state.config) return state;
      return updateConfig(state, {
        navLinks: (state.config.navLinks ?? []).map((l, i) => i === action.index ? action.link : l),
      });

    case 'REMOVE_NAV_LINK': {
      if (!state.config) return state;
      const remaining = (state.config.navLinks ?? []).filter((_, i) => i !== action.index);
      return updateConfig(state, { navLinks: remaining.length > 0 ? remaining : undefined });
    }

    case 'MOVE_NAV_LINK': {
      if (!state.config) return state;
      const links = [...(state.config.navLinks ?? [])];
      const [moved] = links.splice(action.from, 1);
      links.splice(action.to, 0, moved);
      return updateConfig(state, { navLinks: links });
    }

    case 'SET_TAGS':
      if (!state.config) return state;
      return updateConfig(state, { tags: action.tags.length > 0 ? action.tags : undefined });

    case 'SET_SAVING':
      return { ...state, saving: action.saving, error: null };
    case 'SET_ERROR':
      return { ...state, error: action.error, saving: false, uploadProgress: null };
    case 'SET_SAVE_SUCCESS':
      return { ...state, saveSuccess: true, saving: false, uploadProgress: null };
    case 'RESET_DIRTY':
      return { ...state, original: state.config ? structuredClone(state.config) : null };
    case 'SET_UPLOAD_PROGRESS':
      return { ...state, uploadProgress: action.progress };

    case 'SET_SHEET_MUSIC_URL':
      return updateConfig(state, { sheetMusicUrl: action.url });
    case 'SET_REPEAT_AFTER_DC_DS':
      // Drop the field when unchecked so saved configs stay clean.
      return updateConfig(state, {
        repeatAfterDcDs: action.value ? true : undefined,
      });
  }
}
