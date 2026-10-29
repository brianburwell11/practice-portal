/**
 * A song's timestamp notes, shared with everyone who can see the song.
 *
 *   POST   /api/bands/:bandId/songs/:songId/notes            add one   (note.create)
 *   PUT    /api/bands/:bandId/songs/:songId/notes/:noteId    edit one, or `{ restore: true }` to undo a delete
 *   DELETE /api/bands/:bandId/songs/:songId/notes/:noteId    delete one
 *
 * Anyone in the band (not a guest) may add notes, and edit or delete their
 * own; editing or deleting someone else's needs `note.moderate` (Managers and
 * the Owner). Notes from before notes had authors count as someone else's.
 *
 * Notes live in the song's `notes.json` document. A delete only marks the
 * note, so Undo can bring it back; marks older than a day are dropped on the
 * next write, and reads never show them (documents.ts).
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { noteWriteSchema } from '../../../src/config/schema';
import type { Note } from '../../../src/audio/types';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId, can } from '../auth/can';
import { HttpError, json } from '../http';
import { isNoSuchKey } from '../r2';
import { lockSong, readJson, writeJson } from '../store';
import type { Actor, CoreRequest, CoreResponse } from '../types';

interface StoredNote {
  id: string;
  time: number;
  text: string;
  authorId?: string;
  deletedAt?: string;
}

/** How long a deleted note can still be restored. */
const RESTORE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Lock the song, then read its notes (deleted ones too). */
async function loadNotes(bandId: string, songId: string): Promise<{ key: string; notes: StoredNote[] }> {
  if (!(await lockSong(bandId, songId))) throw new HttpError(404, 'Song not found');
  const key = `${bandId}/songs/${songId}/notes.json`;
  try {
    return { key, notes: (await readJson<{ notes: StoredNote[] }>(key)).notes ?? [] };
  } catch (err) {
    if (isNoSuchKey(err)) return { key, notes: [] };
    throw err;
  }
}

async function saveNotes(key: string, notes: StoredNote[]): Promise<void> {
  const cutoff = Date.now() - RESTORE_WINDOW_MS;
  const kept = notes
    .filter((n) => !n.deletedAt || new Date(n.deletedAt).getTime() > cutoff)
    .sort((a, b) => a.time - b.time);
  await writeJson(key, { notes: kept });
}

/** The note as the app shows it: who wrote it, by name and picture. */
async function withAuthor(note: StoredNote): Promise<Note> {
  const view: Note = { id: note.id, time: note.time, text: note.text };
  if (!note.authorId) return view;
  const [user] = await db().select({ name: schema.appUser.displayName, avatarUrl: schema.appUser.avatarUrl })
    .from(schema.appUser).where(eq(schema.appUser.id, note.authorId));
  // Never the email address: anyone who can see the song sees its notes (documents.ts).
  if (user) view.author = { id: note.authorId, name: user.name ?? 'Band member', avatarUrl: user.avatarUrl };
  return view;
}

/** Your own note, or anyone's with `note.moderate`. */
async function requireMayChange(actor: Actor, bandId: string, note: StoredNote): Promise<void> {
  if (note.authorId === actor.userId) return;
  if (!(await can(actor, 'note.moderate', await bandByLegacyId(bandId)))) {
    throw new HttpError(403, 'Only a Manager or the Owner can change someone else’s note');
  }
}

export async function createNote(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const { time, text } = noteWriteSchema.parse(req.body);
  const { key, notes } = await loadNotes(bandId, songId);
  const note: StoredNote = { id: `n_${randomBytes(6).toString('hex')}`, time, text, authorId: req.actor!.userId };
  await saveNotes(key, [...notes, note]);
  return json({ note: await withAuthor(note) });
}

export async function updateNote(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId, noteId } = req.params;
  const body = (req.body ?? {}) as { restore?: unknown };
  const { key, notes } = await loadNotes(bandId, songId);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new HttpError(404, 'No such note');
  await requireMayChange(req.actor!, bandId, note);

  if (body.restore === true) {
    if (!note.deletedAt) return json({ note: await withAuthor(note) });
    delete note.deletedAt;
  } else {
    if (note.deletedAt) throw new HttpError(404, 'No such note');
    const { time, text } = noteWriteSchema.parse(req.body);
    note.time = time;
    note.text = text;
  }
  await saveNotes(key, notes);
  return json({ note: await withAuthor(note) });
}

export async function deleteNote(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId, noteId } = req.params;
  const { key, notes } = await loadNotes(bandId, songId);
  const note = notes.find((n) => n.id === noteId && !n.deletedAt);
  if (!note) throw new HttpError(404, 'No such note');
  await requireMayChange(req.actor!, bandId, note);
  note.deletedAt = new Date().toISOString();
  await saveNotes(key, notes);
  return json({ ok: true });
}
