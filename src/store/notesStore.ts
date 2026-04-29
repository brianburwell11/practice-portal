import { create } from 'zustand';
import type { Note } from '../audio/types';

/** How many seconds before a note's timestamp the sticky becomes visible. */
export const NOTE_LEAD_SECONDS = 3;
/** How many seconds after a note's timestamp the sticky stays visible. */
export const NOTE_TAIL_SECONDS = 2;
/** Single fixed sticky-note color, shared with the marker on the waveform. */
export const NOTE_COLOR = '#FFE066';

function genId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface NotesState {
  /** All notes (saved + drafts + locally-edited saved). */
  notes: Note[];
  /** IDs whose current text hasn't been persisted yet. */
  dirty: Set<string>;
  /** True once `load()` has run for the current song. */
  loaded: boolean;
  /** Identifies which song's notes.json we'd POST to when saving. */
  bandId: string | null;
  songId: string | null;

  load: (bandId: string, songId: string, notes: Note[]) => void;
  clear: () => void;
  createDraft: (time: number) => string;
  setText: (id: string, text: string) => void;
  saveNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

async function persistSavedSet(bandId: string, songId: string, notes: Note[]): Promise<void> {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const res = await fetch(`/api/bands/${bandId}/songs/${songId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: sorted }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  dirty: new Set(),
  loaded: false,
  bandId: null,
  songId: null,

  load: (bandId, songId, notes) =>
    set({
      bandId,
      songId,
      notes: [...notes].sort((a, b) => a.time - b.time),
      dirty: new Set(),
      loaded: true,
    }),

  clear: () =>
    set({ notes: [], dirty: new Set(), loaded: false, bandId: null, songId: null }),

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

  saveNote: async (id) => {
    const { notes, dirty, bandId, songId } = get();
    if (!bandId || !songId) throw new Error('No song loaded');
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    const persistedSet = notes.filter((n) => !nextDirty.has(n.id));
    await persistSavedSet(bandId, songId, persistedSet);
    set({ dirty: nextDirty });
  },

  deleteNote: async (id) => {
    const { notes, dirty, bandId, songId } = get();
    const wasDirty = dirty.has(id);
    const remaining = notes.filter((n) => n.id !== id);
    const nextDirty = new Set(dirty);
    nextDirty.delete(id);

    // If the note was already persisted, push the new saved set up to the server.
    if (!wasDirty) {
      if (!bandId || !songId) throw new Error('No song loaded');
      const persistedSet = remaining.filter((n) => !nextDirty.has(n.id));
      await persistSavedSet(bandId, songId, persistedSet);
    }
    set({ notes: remaining, dirty: nextDirty });
  },
}));
