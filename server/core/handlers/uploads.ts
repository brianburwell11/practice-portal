import fs from 'node:fs';
import path from 'node:path';
import { HttpError, errorMessage, json, ok } from '../http';
import { assertR2Configured, r2PresignPut, r2PublicUrl, r2PutFile } from '../r2';
import {
  ffprobe,
  measureLoudness,
  transcodeToOpus,
  type LoudnessInfo,
} from '../media/ffmpeg';
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
 * Transcode uploaded stems to Opus and put them on R2.
 *
 * Alignment offsets are NOT baked in — they live in config.json and are
 * applied at playback time by StemPlayer. The opus files on R2 are
 * authoritative and unmodified.
 */
export async function transcodeUpload(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId } = req.params;
  // Default to true so existing callers (older clients, scripts) keep the
  // historical loudnorm behavior.
  const normalize = req.query.get('normalize') !== '0';

  const r2Prefix = `${bandId}/songs/${songId}`;
  const tmpDir = req.tmpDir!;
  const fileMap: Record<string, string> = {}; // origName → transcoded name

  for (const file of req.files ?? []) {
    const probe = ffprobe(file.path);

    let loudness: LoudnessInfo | undefined;
    if (normalize) {
      try {
        loudness = measureLoudness(file.path);
      } catch (err) {
        console.warn(`Loudness measurement failed for ${file.filename}, transcoding without normalization:`, errorMessage(err));
      }
    }

    const baseName = path.basename(file.filename, path.extname(file.filename));
    const uploadName = `${baseName}.opus`;
    const uploadPath = path.join(tmpDir, `out-${uploadName}`);
    transcodeToOpus(file.path, uploadPath, probe, loudness, normalize);

    await r2PutFile(
      `${r2Prefix}/${uploadName}`,
      fs.readFileSync(uploadPath),
      'audio/opus',
      'public, max-age=31536000, immutable',
    );

    fileMap[file.filename] = uploadName;
  }

  return ok({ fileMap, publicBase: `${r2PublicUrl()}/${r2Prefix}` });
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

  const mscoreBin = resolveMscoreBin();
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
  convertScore(mscoreBin, received.path, outPath);

  await r2PutFile(
    `${bandId}/songs/${songId}/${filename}`,
    fs.readFileSync(outPath),
    'application/vnd.recordare.musicxml',
    'public, max-age=31536000, immutable',
  );

  return ok({ filename });
}

/** Presigned PUT URLs so the browser can upload straight to R2. */
export async function presignUploads(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, songId, files } = (req.body ?? {}) as {
    bandId?: string;
    songId?: string;
    files?: string[];
  };
  if (!bandId || !songId || !files?.length) {
    throw new HttpError(400, 'bandId, songId and files[] required');
  }

  const r2Prefix = `${bandId}/songs/${songId}`;
  const urls: Record<string, string> = {};
  for (const filename of files) {
    urls[filename] = await r2PresignPut(`${r2Prefix}/${filename}`);
  }

  return json({ urls, publicBase: `${r2PublicUrl()}/${r2Prefix}` });
}
