import { create } from 'zustand';
import type { Note } from '../audio/types';
import type { DeletedNote } from './notesStore';

/** Personal notes are blue, matching the prominent UI accent (playhead, primary buttons). */
export const PERSONAL_NOTE_COLOR = '#3B82F6';

const STORAGE_KEY_PREFIX = 'practice-portal.personalNotes';

function storageKey(songId: string): string {
  return `${STORAGE_KEY_PREFIX}.${songId}`;
}

function loadFromStorage(songId: string): Note[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey(songId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.notes)) return [];
    return parsed.notes.filter(
      (n: any) => n && typeof n.id === 'string' && typeof n.time === 'number' && typeof n.text === 'string',
    );
  } catch {
    return [];
  }
}

function saveToStorage(songId: string, notes: Note[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (notes.length === 0) {
      window.localStorage.removeItem(storageKey(songId));
    } else {
      window.localStorage.setItem(storageKey(songId), JSON.stringify({ notes }));
    }
  } catch {
    // localStorage can throw on quota / private mode — fail silently.
  }
}

function genId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface PersonalNotesState {
  notes: Note[];
  dirty: Set<string>;
  loaded: boolean;
  songId: string | null;
  lastDeleted: DeletedNote | null;

  load: (songId: string) => void;
  clear: () => void;
  createDraft: (time: number) => string;
  setText: (id: string, text: string) => void;
  setTime: (id: string, time: number) => void;
  saveNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  undoDelete: () => Promise<void>;
  clearLastDeleted: () => void;
}

export const usePersonalNotesStore = create<PersonalNotesState>((set, get) => ({
  notes: [],
  dirty: new Set(),
  loaded: false,
  songId: null,
  lastDeleted: null,

  load: (songId) =>
    set({
      songId,
      notes: loadFromStorage(songId).sort((a, b) => a.time - b.time),
      dirty: new Set(),
      loaded: true,
      lastDeleted: null,
    }),

  clear: () =>
    set({ notes: [], dirty: new Set(), loaded: false, songId: null, lastDeleted: null }),

  createDraft: (time) => {
    const id = genId();
    set((s) => {
      const next = [...s.notes, { id, time, text: '' }].sort((a, b) => a.time - b.time);
      const dirty = new Set(s.dirty);
      dirty.add(id);
      return { notes: next, dirty };
    });
    return id;
  },

  setText: (id, text) =>
    set((s) => {
      const notes = s.notes.map((n) => (n.id === id ? { ...n, text } : n));
      const dirty = new Set(s.dirty);
      dirty.add(id);
      return { notes, dirty };
    }),

  setTime: (id, time) =>
    set((s) => {
      const next = s.notes
        .map((n) => (n.id === id ? { ...n, time: Math.max(0, time) } : n))
        .sort((a, b) => a.time - b.time);
      const dirty = new Set(s.dirty);
      dirty.add(id);
      return { notes: next, dirty };
    }),

  saveNote: async (id) => {
    const { notes, dirty, songId } = get();
    if (!songId) return;
    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    const persistedSet = notes.filter((n) => !nextDirty.has(n.id));
    saveToStorage(songId, persistedSet);
    set({ dirty: nextDirty });
  },

  deleteNote: async (id) => {
    const { notes, dirty, songId } = get();
    const target = notes.find((n) => n.id === id);
    if (!target) return;
    const wasDirty = dirty.has(id);
    const wasSaved = !wasDirty;
    const remaining = notes.filter((n) => n.id !== id);
    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    if (wasSaved && songId) {
      const persistedSet = remaining.filter((n) => !nextDirty.has(n.id));
      saveToStorage(songId, persistedSet);
    }
    set({
      notes: remaining,
      dirty: nextDirty,
      lastDeleted: { note: target, wasSaved, deletedAt: Date.now() },
    });
  },

  undoDelete: async () => {
    const { lastDeleted, notes, dirty, songId } = get();
    if (!lastDeleted) return;
    const { note, wasSaved } = lastDeleted;
    const restored = [...notes, note].sort((a, b) => a.time - b.time);
    const nextDirty = new Set(dirty);
    if (wasSaved && songId) {
      const persistedSet = restored.filter((n) => !nextDirty.has(n.id));
      saveToStorage(songId, persistedSet);
    } else {
      nextDirty.add(note.id);
    }
    set({ notes: restored, dirty: nextDirty, lastDeleted: null });
  },

  clearLastDeleted: () => set({ lastDeleted: null }),
}));
