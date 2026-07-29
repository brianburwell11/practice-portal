import {
  songConfigSchema,
  lyricsDataSchema,
  notesDataSchema,
} from '../../../src/config/schema';
import { HttpError, ok } from '../http';
import {
  isNoSuchKey,
  r2CopyKey,
  r2DeleteKey,
  r2ListKeys,
  r2ReadJson,
  r2WriteJson,
} from '../r2';
import { updateSetlistEntries } from '../setlistEntries';
import type { CoreRequest, CoreResponse } from '../types';

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
  await r2WriteJson(`${bandId}/songs/${songId}/config.json`, validated);
  return ok();
}

export async function saveSongLyrics(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const validated = lyricsDataSchema.parse(req.body);
  await r2WriteJson(`${bandId}/songs/${songId}/lyrics.json`, validated);
  return ok();
}

export async function saveSongNotes(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const validated = notesDataSchema.parse(req.body);
  const key = `${bandId}/songs/${songId}/notes.json`;
  if (validated.notes.length === 0) {
    try {
      await r2DeleteKey(key);
    } catch {
      // already absent — fine
    }
  } else {
    await r2WriteJson(key, validated);
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
  const discography = await r2ReadJson<Discography>(`${bandId}/songs/discography.json`);
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

  // 1. Copy song config to new key on R2
  try {
    const oldConfig = await r2ReadJson<{ id: string }>(`${bandId}/songs/${oldId}/config.json`);
    oldConfig.id = newId;
    await r2WriteJson(`${bandId}/songs/${newId}/config.json`, oldConfig);
    await r2DeleteKey(`${bandId}/songs/${oldId}/config.json`);
  } catch {
    // config may not exist yet
  }

  // 2. Copy audio stems from old prefix to new prefix
  const oldAudioPrefix = `${bandId}/songs/${oldId}/`;
  const newAudioPrefix = `${bandId}/songs/${newId}/`;
  const audioKeys = await r2ListKeys(oldAudioPrefix);

  for (const key of audioKeys) {
    const filename = key.slice(oldAudioPrefix.length);
    await r2CopyKey(key, `${newAudioPrefix}${filename}`);
  }
  for (const key of audioKeys) {
    await r2DeleteKey(key);
  }

  // 3. Update discography.json
  const entry = discography.songs.find((s) => s.id === oldId);
  if (entry) {
    entry.id = newId;
    if (entry.audioBasePath) {
      entry.audioBasePath = entry.audioBasePath.replace(`songs/${oldId}`, `songs/${newId}`);
    }
  }
  await r2WriteJson(`${bandId}/songs/discography.json`, discography);

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
    await r2DeleteKey(`${bandId}/songs/${songId}/config.json`);
  } catch {
    // config may not exist
  }

  // 2. Delete audio stems from R2
  const audioKeys = await r2ListKeys(`${bandId}/songs/${songId}/`);
  for (const key of audioKeys) {
    await r2DeleteKey(key);
  }

  // 3. Remove from discography.json
  try {
    const discography = await r2ReadJson<Discography>(`${bandId}/songs/discography.json`);
    discography.songs = discography.songs.filter((s) => s.id !== songId);
    await r2WriteJson(`${bandId}/songs/discography.json`, discography);
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
  // Reject anything that looks like a path — we only delete
  // direct children of the song's R2 folder.
  if (!filename || filename.includes('/') || filename.includes('..')) {
    throw new HttpError(400, 'Invalid filename');
  }
  await r2DeleteKey(`${bandId}/songs/${songId}/${filename}`);
  return ok();
}

export async function upsertDiscographyEntry(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const { overwrite, ...entry } = (req.body ?? {}) as { overwrite?: boolean } & DiscographyEntry;

  let discography: Discography;
  try {
    discography = await r2ReadJson<Discography>(`${bandId}/songs/discography.json`);
  } catch (err) {
    // Only treat missing-object as empty discography. Re-throw
    // transient/network errors so we never wipe an existing file.
    if (isNoSuchKey(err)) {
      discography = { songs: [] };
    } else {
      throw err;
    }
  }

  const exists = discography.songs.some((s) => s.id === entry.id);
  if (exists && !overwrite) {
    throw new HttpError(
      409,
      `Song id "${entry.id}" already exists. Delete it first or pick a different title/artist.`,
    );
  }

  // Upsert entry
  discography.songs = discography.songs.filter((s) => s.id !== entry.id);
  discography.songs.push(entry);

  await r2WriteJson(`${bandId}/songs/discography.json`, discography);
  return ok();
}
