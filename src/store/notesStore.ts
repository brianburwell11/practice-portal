import { create } from 'zustand';
import type { Note } from '../audio/types';

/** How many seconds before a note's timestamp the sticky becomes visible. */
export const NOTE_LEAD_SECONDS = 3;
/** How many seconds after a note's timestamp the sticky stays visible. */
export const NOTE_TAIL_SECONDS = 2;
/** Single fixed sticky-note color, shared with the marker on the waveform. */
export const NOTE_COLOR = '#FFE066';

/** Drafts get a local id until the server gives them a real one. */
const DRAFT_PREFIX = 'draft_';

function draftId(): string {
  return `${DRAFT_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isDraft(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

/** A note that was just deleted, kept around briefly so the UI can offer Undo. */
export interface DeletedNote {
  note: Note;
  /** True if the note was saved on the server before deletion (vs. a draft). */
  wasSaved: boolean;
  deletedAt: number;
}

interface NotesState {
  /** Every note on the song, saved and draft, everyone's. */
  notes: Note[];
  /** IDs whose current text or time hasn't been saved yet (drafts and edits). */
  dirty: Set<string>;
  /** True once `load()` has run for the current song. */
  loaded: boolean;
  bandId: string | null;
  songId: string | null;
  /** Most recently deleted note, available for Undo for ~5s. */
  lastDeleted: DeletedNote | null;

  load: (bandId: string, songId: string, notes: Note[]) => void;
  clear: () => void;
  createDraft: (time: number) => string;
  setText: (id: string, text: string) => void;
  setTime: (id: string, time: number) => void;
  saveNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  undoDelete: () => Promise<void>;
  clearLastDeleted: () => void;
}

const sortByTime = (notes: Note[]) => [...notes].sort((a, b) => a.time - b.time);

/** One note request; returns the server's copy of the note, if it sent one. */
async function noteRequest(method: string, path: string, body?: unknown): Promise<Note | null> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return (data.note as Note | undefined) ?? null;
}

export const useNotesStore = create<NotesState>((set, get) => {
  const base = () => {
    const { bandId, songId } = get();
    if (!bandId || !songId) throw new Error('No song loaded');
    return `/api/bands/${encodeURIComponent(bandId)}/songs/${encodeURIComponent(songId)}/notes`;
  };
  /** Swap a note for the server's copy (a draft's id becomes the real one). */
  const replace = (oldId: string, note: Note) =>
    set((s) => {
      const dirty = new Set(s.dirty);
      dirty.delete(oldId);
      return { notes: sortByTime(s.notes.map((n) => (n.id === oldId ? note : n))), dirty };
    });

  return {
    notes: [],
    dirty: new Set(),
    loaded: false,
    bandId: null,
    songId: null,
    lastDeleted: null,

    load: (bandId, songId, notes) =>
      set({ bandId, songId, notes: sortByTime(notes), dirty: new Set(), loaded: true, lastDeleted: null }),

    clear: () =>
      set({ notes: [], dirty: new Set(), loaded: false, bandId: null, songId: null, lastDeleted: null }),

    createDraft: (time) => {
      const id = draftId();
      set((s) => ({ notes: sortByTime([...s.notes, { id, time, text: '' }]), dirty: new Set(s.dirty).add(id) }));
      return id;
    },

    setText: (id, text) =>
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, text } : n)), dirty: new Set(s.dirty).add(id) })),

    setTime: (id, time) =>
      set((s) => ({
        notes: sortByTime(s.notes.map((n) => (n.id === id ? { ...n, time: Math.max(0, time) } : n))),
        dirty: new Set(s.dirty).add(id),
      })),

    saveNote: async (id) => {
      const note = get().notes.find((n) => n.id === id);
      if (!note) return;
      const body = { time: note.time, text: note.text };
      const saved = isDraft(id)
        ? await noteRequest('POST', base(), body)
        : await noteRequest('PUT', `${base()}/${encodeURIComponent(id)}`, body);
      if (saved) replace(id, saved);
    },

    deleteNote: async (id) => {
      const target = get().notes.find((n) => n.id === id);
      if (!target) return;
      const wasSaved = !isDraft(id);
      if (wasSaved) await noteRequest('DELETE', `${base()}/${encodeURIComponent(id)}`);
      set((s) => {
        const dirty = new Set(s.dirty);
        dirty.delete(id);
        return {
          notes: s.notes.filter((n) => n.id !== id),
          dirty,
          lastDeleted: { note: target, wasSaved, deletedAt: Date.now() },
        };
      });
    },

    undoDelete: async () => {
      const { lastDeleted } = get();
      if (!lastDeleted) return;
      const { note, wasSaved } = lastDeleted;
      if (wasSaved) {
        // The server kept it, marked deleted: bring it back as it was saved.
        const restored = await noteRequest('PUT', `${base()}/${encodeURIComponent(note.id)}`, { restore: true });
        set((s) => ({ notes: sortByTime([...s.notes, restored ?? note]), lastDeleted: null }));
      } else {
        // A draft: back as a draft, Save button and all.
        set((s) => ({ notes: sortByTime([...s.notes, note]), dirty: new Set(s.dirty).add(note.id), lastDeleted: null }));
      }
    },

    clearLastDeleted: () => set({ lastDeleted: null }),
  };
});
