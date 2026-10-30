import fs from 'node:fs';
import path from 'node:path';
import { HttpError, json, ok } from '../http';
import { assertR2Configured, r2PresignPut, r2PublicUrl, r2PutFile } from '../r2';
import { MSCORE_MISSING_MESSAGE, convertScore, resolveMscoreBin } from '../media/musescore';
import type { CoreRequest, CoreResponse, RouteTarget } from '../types';

/** Cap `.mscz` uploads so a bad client can't fill the scratch disk. */
export const MSCZ_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Target filename for the converted score's R2 key. The client sends it as a
 * `?filename=<kebab>.mxl` query param; we re-validate to refuse anything bad
 * (path traversal, wrong extension, oversized). Falls back to `score.mxl` if
 * the param is absent, matching the pre-sanitization callers.
 */
function msczTargetFilename(query: URLSearchParams): string {
  const filename = query.get('filename') ?? 'score.mxl';
  if (!/^[a-z0-9-]{1,40}\.mxl$/.test(filename)) {
    throw new HttpError(400, `Invalid filename "${filename}" — expected [a-z0-9-]{1,40}.mxl`);
  }
  return filename;
}

/** Reject a `.mscz` upload on its query string alone, before it is streamed. */
export function msczPrecheck({ query }: RouteTarget): void {
  msczTargetFilename(query);
  assertR2Configured();
}

/** Missing R2 credentials shouldn't be discovered after a multi-hundred-MB upload. */
export function requireR2Precheck(): void {
  assertR2Configured();
}

/**
 * Accepts a single `.mscz` upload, shells out to the MuseScore CLI to convert
 * it to MXL, and uploads the result to R2 under the requested filename — the
 * same canonical naming as the presign+PUT path for `.musicxml` / `.xml` /
 * `.mxl`, so InfiniteScoreRenderer picks it up with no changes.
 */
export async function msczConvertUpload(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  const filename = msczTargetFilename(req.query);

  const mscoreBin = await resolveMscoreBin();
  if (!mscoreBin) throw new HttpError(500, MSCORE_MISSING_MESSAGE);

  const received = req.files?.[0];
  if (!received) throw new Error('No file in upload');

  // Sanity-check extension so we don't feed MuseScore random binaries. The
  // client already filters this, but an attacker hitting the API directly
  // would bypass that.
  const ext = path.extname(received.filename).toLowerCase();
  if (ext !== '.mscz') {
    throw new HttpError(400, `Expected .mscz upload, got "${received.filename}"`);
  }

  const outPath = path.join(req.tmpDir!, filename);
  await convertScore(mscoreBin, received.path, outPath);

  await r2PutFile(
    `${bandId}/songs/${songId}/${filename}`,
    fs.readFileSync(outPath),
    'application/vnd.recordare.musicxml',
    'public, max-age=31536000, immutable',
  );

  return ok({ filename });
}

/** A sheet-music file in a song's folder, as the app names them (`wiggle-sooza.mxl`). */
export const SCORE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(mxl|musicxml|xml|mscz)$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What a score is stored and served as, by extension. */
export function scoreContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.mxl') return 'application/vnd.recordare.musicxml';
  if (ext === '.mscz') return 'application/octet-stream';
  return 'application/vnd.recordare.musicxml+xml';
}

/**
 * Presigned PUT URLs so the browser can upload a score straight to R2.
 * `sizes[i]` is the byte size of `files[i]`; it is signed into the URL along
 * with the type the browser must send (`contentTypes`).
 */
export async function presignUploads(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId, files, sizes } = (req.body ?? {}) as {
    bandId?: string;
    songId?: string;
    files?: string[];
    sizes?: number[];
  };
  if (!bandId || !songId || !Array.isArray(files) || !files.length) {
    throw new HttpError(400, 'bandId, songId and files[] required');
  }
  // Scores only, and only in the song's folder: stems go through the stem
  // jobs, and the song's JSON documents are never uploaded directly.
  if (!ID.test(bandId) || !ID.test(songId) || files.length > 4
      || !files.every((f) => typeof f === 'string' && SCORE_FILENAME.test(f))) {
    throw new HttpError(400, 'Only sheet-music files (.mxl, .musicxml, .xml) can be uploaded here');
  }
  if (!Array.isArray(sizes) || sizes.length !== files.length
      || !sizes.every((n) => Number.isInteger(n) && n > 0 && n <= MSCZ_MAX_BYTES)) {
    throw new HttpError(400, `Each score needs its size, up to ${MSCZ_MAX_BYTES / 1024 / 1024} MB`);
  }

  const r2Prefix = `${bandId}/songs/${songId}`;
  const urls: Record<string, string> = {};
  const contentTypes: Record<string, string> = {};
  for (const [i, filename] of files.entries()) {
    contentTypes[filename] = scoreContentType(filename);
    urls[filename] = await r2PresignPut(`${r2Prefix}/${filename}`, {
      contentType: contentTypes[filename],
      contentLength: sizes[i],
    });
  }

  return json({ urls, contentTypes, publicBase: `${r2PublicUrl()}/${r2Prefix}` });
}
