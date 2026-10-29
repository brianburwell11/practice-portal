import {
  songConfigSchema,
  lyricsDataSchema,
  notesDataSchema,
} from '../../../src/config/schema';
import { HttpError, ok } from '../http';
import { isNoSuchKey, r2ListKeys } from '../r2';
import { copyObject, deleteObject, readJson, writeJson } from '../store';
import { updateSetlistEntries } from '../setlistEntries';
import type { CoreRequest, CoreResponse } from '../types';
import { SCORE_FILENAME } from './uploads';

interface DiscographyEntry {
  id: string;
  audioBasePath?: string;
  [k: string]: unknown;
}

interface Discography {
  songs: DiscographyEntry[];
}

export async function saveSongConfig(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const validated = songConfigSchema.parse(req.body);
  await writeJson(`${bandId}/songs/${songId}/config.json`, validated);
  return ok();
}

export async function saveSongLyrics(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const validated = lyricsDataSchema.parse(req.body);
  await writeJson(`${bandId}/songs/${songId}/lyrics.json`, validated);
  return ok();
}

export async function saveSongNotes(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const validated = notesDataSchema.parse(req.body);
  const key = `${bandId}/songs/${songId}/notes.json`;
  if (validated.notes.length === 0) {
    try {
      await deleteObject(key);
    } catch {
      // already absent — fine
    }
  } else {
    await writeJson(key, validated);
  }
  return ok();
}

export async function renameSong(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const oldId = req.params.songId;
  const { newId } = (req.body ?? {}) as { newId?: string };

  if (!newId || oldId === newId) {
    return ok({ noChange: true });
  }

  // Conflict check against R2 discography
  const discography = await readJson<Discography>(`${bandId}/songs/discography.json`);
  if (discography.songs.some((s) => s.id === newId)) {
    throw new HttpError(409, `Song ID "${newId}" already exists`);
  }

  // Also check R2 directory — discography may be clean but orphaned
  // files under the target prefix would be silently overwritten by
  // the copy step below.
  const existingAtTarget = await r2ListKeys(`${bandId}/songs/${newId}/`);
  if (existingAtTarget.length > 0) {
    throw new HttpError(
      409,
      `R2 directory for "${newId}" is not empty (${existingAtTarget.length} file(s)). Clean it up before renaming.`,
    );
  }

  // 1. The config under its new id. The old one is deleted last: deleting a
  //    config deletes the song's row, and its lyrics and notes with it, so
  //    they have to be copied across first.
  const oldConfigKey = `${bandId}/songs/${oldId}/config.json`;
  try {
    const oldConfig = await readJson<{ id: string }>(oldConfigKey);
    oldConfig.id = newId;
    await writeJson(`${bandId}/songs/${newId}/config.json`, oldConfig);
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
    // config may not exist yet
  }

  // 2. Everything else under the old prefix — stems, score, lyrics, notes.
  //    Copies happen now; the deletes wait for the commit (see store.ts).
  const oldAudioPrefix = `${bandId}/songs/${oldId}/`;
  const newAudioPrefix = `${bandId}/songs/${newId}/`;
  const audioKeys = await r2ListKeys(oldAudioPrefix);

  for (const key of audioKeys) {
    if (key === oldConfigKey) continue; // already written, with the new id
    const filename = key.slice(oldAudioPrefix.length);
    await copyObject(key, `${newAudioPrefix}${filename}`);
  }
  for (const key of audioKeys) {
    if (key !== oldConfigKey) await deleteObject(key);
  }
  await deleteObject(oldConfigKey);

  // 3. Update discography.json
  const entry = discography.songs.find((s) => s.id === oldId);
  if (entry) {
    entry.id = newId;
    if (entry.audioBasePath) {
      entry.audioBasePath = entry.audioBasePath.replace(`songs/${oldId}`, `songs/${newId}`);
    }
  }
  await writeJson(`${bandId}/songs/discography.json`, discography);

  // 4. Update songId in any setlists
  await updateSetlistEntries(bandId, (e) =>
    e.type === 'song' && e.songId === oldId
      ? { ...e, songId: newId }
      : e,
  );

  return ok({ newId });
}

export async function deleteSong(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;

  // 1. Delete song config from R2
  try {
    await deleteObject(`${bandId}/songs/${songId}/config.json`);
  } catch {
    // config may not exist
  }

  // 2. Delete audio stems from R2
  const audioKeys = await r2ListKeys(`${bandId}/songs/${songId}/`);
  for (const key of audioKeys) {
    await deleteObject(key);
  }

  // 3. Remove from discography.json
  try {
    const discography = await readJson<Discography>(`${bandId}/songs/discography.json`);
    discography.songs = discography.songs.filter((s) => s.id !== songId);
    await writeJson(`${bandId}/songs/discography.json`, discography);
  } catch {
    // discography may not exist
  }

  // 4. Remove song from any setlists
  await updateSetlistEntries(bandId, (e) =>
    e.type === 'song' && e.songId === songId ? null : e,
  );

  return ok();
}

/**
 * Removes a single file within a song's folder. Used by the Edit Song save
 * handler to clean up orphaned sheet-music files when the user removes or
 * replaces the score.
 */
export async function deleteSongFile(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const filename = decodeURIComponent(req.params.filename);
  // Only a score file, directly in the song's folder. The route needs just
  // `song.score.write`, so it must never reach config.json, lyrics or notes:
  // deleting config.json would delete the song.
  if (!SCORE_FILENAME.test(filename)) {
    throw new HttpError(400, 'Only a sheet-music file can be deleted here');
  }
  await deleteObject(`${bandId}/songs/${songId}/${filename}`);
  return ok();
}

export async function upsertDiscographyEntry(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const { overwrite, ...entry } = (req.body ?? {}) as { overwrite?: boolean } & DiscographyEntry;

  let discography: Discography;
  try {
    discography = await readJson<Discography>(`${bandId}/songs/discography.json`);
  } catch (err) {
    // Only treat missing-object as empty discography. Re-throw
    // transient/network errors so we never wipe an existing file.
    if (isNoSuchKey(err)) {
      discography = { songs: [] };
    } else {
      throw err;
    }
  }

  // Since Phase 6b the discography is built from the song configs, so the
  // wizard's own song — config saved a moment ago — is already listed when
  // this runs. Only a *different* song under the same id is a conflict.
  const existing = discography.songs.find((s) => s.id === entry.id);
  const sameSong = existing && existing.title === entry.title && existing.artist === entry.artist;
  if (existing && !sameSong && !overwrite) {
    throw new HttpError(
      409,
      `Song id "${entry.id}" already exists. Delete it first or pick a different title/artist.`,
    );
  }

  // Upsert entry
  discography.songs = discography.songs.filter((s) => s.id !== entry.id);
  discography.songs.push(entry);

  await writeJson(`${bandId}/songs/discography.json`, discography);
  return ok();
}
