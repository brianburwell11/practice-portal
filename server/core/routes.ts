/**
 * The API surface, as data.
 *
 * Order matters: the router takes the first method+pathname match. This table
 * mirrors the order the routes were checked in when they lived inside the Vite
 * middleware, so precedence is unchanged.
 *
 * Phase 6 adds a required capability to each entry and a test that asserts no
 * write route is missing one — which is why the surface lives here rather than
 * being spread across handler files.
 */
import {
  bandStorage,
  deleteBand,
  putBand,
  rebuildRegistry,
  uploadBandLogo,
} from './handlers/bands';
import { readData } from './handlers/data';
import { deleteSetlist, saveSetlist } from './handlers/setlists';
import {
  deleteSong,
  deleteSongFile,
  renameSong,
  saveSongConfig,
  saveSongLyrics,
  saveSongNotes,
  upsertDiscographyEntry,
} from './handlers/songs';
import {
  MSCZ_MAX_BYTES,
  msczConvertUpload,
  msczPrecheck,
  presignUploads,
  requireR2Precheck,
  transcodeUpload,
} from './handlers/uploads';
import type { RouteDef } from './types';

export const routes: RouteDef[] = [
  {
    // The JSON documents R2 serves publicly today, from Postgres (Phase 4).
    name: 'data.read',
    method: 'GET',
    pattern: /^\/api\/data\/(?<key>[^?#]+\.json)$/,
    public: true,
    handler: readData,
    errorStatus: 500,
    errorMessage: 'Read failed',
  },
  {
    name: 'song.config.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)\/config$/,
    body: 'json',
    handler: saveSongConfig,
    errorStatus: 400,
    errorMessage: 'Invalid request',
  },
  {
    name: 'song.lyrics.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)\/lyrics$/,
    body: 'json',
    handler: saveSongLyrics,
    errorStatus: 400,
    errorMessage: 'Invalid request',
  },
  {
    name: 'song.notes.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)\/notes$/,
    body: 'json',
    handler: saveSongNotes,
    errorStatus: 400,
    errorMessage: 'Invalid request',
  },
  {
    name: 'song.rename',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)\/rename$/,
    body: 'json',
    handler: renameSong,
    errorStatus: 500,
    errorMessage: 'Rename failed',
  },
  {
    name: 'band.logo.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/logo$/,
    body: 'multipart',
    handler: uploadBandLogo,
    errorStatus: 400,
    errorMessage: 'Upload failed',
  },
  {
    name: 'song.audio.transcode',
    method: 'POST',
    pattern: /^\/api\/r2\/transcode-upload\/(?<bandId>[^/]+)\/(?<songId>[^/]+)$/,
    body: 'multipart',
    precheck: requireR2Precheck,
    handler: transcodeUpload,
    errorStatus: 500,
    errorMessage: 'Transcode/upload failed',
  },
  {
    name: 'song.score.convert',
    method: 'POST',
    pattern: /^\/api\/r2\/mscz-convert-upload\/(?<bandId>[^/]+)\/(?<songId>[^/]+)$/,
    body: 'multipart',
    limits: { files: 1, fileSize: MSCZ_MAX_BYTES },
    precheck: msczPrecheck,
    handler: msczConvertUpload,
    errorStatus: 500,
    errorMessage: 'MSCZ convert/upload failed',
  },
  {
    name: 'song.audio.presign',
    method: 'POST',
    pattern: /^\/api\/r2\/presign$/,
    body: 'json',
    precheck: requireR2Precheck,
    handler: presignUploads,
    errorStatus: 400,
    errorMessage: 'Presign failed',
  },
  {
    name: 'registry.rebuild',
    method: 'POST',
    pattern: /^\/api\/registry\/rebuild$/,
    handler: rebuildRegistry,
    errorStatus: 500,
    errorMessage: 'Rebuild failed',
  },
  {
    name: 'band.storage.read',
    method: 'GET',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/storage$/,
    handler: bandStorage,
    errorStatus: 500,
    errorMessage: 'Storage lookup failed',
  },
  {
    name: 'band.settings.write',
    method: 'PUT',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)$/,
    body: 'json',
    handler: putBand,
    errorStatus: 400,
    errorMessage: 'Invalid request',
  },
  {
    name: 'band.delete',
    method: 'DELETE',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)$/,
    handler: deleteBand,
    errorStatus: 500,
    errorMessage: 'Delete band failed',
  },
  {
    name: 'song.discography.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/discography$/,
    body: 'json',
    handler: upsertDiscographyEntry,
    errorStatus: 400,
    errorMessage: 'Invalid request',
  },
  {
    name: 'song.delete',
    method: 'DELETE',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)$/,
    handler: deleteSong,
    errorStatus: 500,
    errorMessage: 'Delete failed',
  },
  {
    name: 'song.file.delete',
    method: 'DELETE',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/songs\/(?<songId>[^/]+)\/file\/(?<filename>[^/]+)$/,
    handler: deleteSongFile,
    errorStatus: 500,
    errorMessage: 'Delete failed',
  },
  {
    name: 'setlist.write',
    method: 'POST',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/setlists\/(?<setlistId>[^/]+)$/,
    body: 'json',
    handler: saveSetlist,
    errorStatus: 400,
    errorMessage: 'Save setlist failed',
  },
  {
    name: 'setlist.delete',
    method: 'DELETE',
    pattern: /^\/api\/bands\/(?<bandId>[^/]+)\/setlists\/(?<setlistId>[^/]+)$/,
    handler: deleteSetlist,
    errorStatus: 500,
    errorMessage: 'Delete setlist failed',
  },
];
