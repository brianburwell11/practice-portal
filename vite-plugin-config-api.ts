import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync, execFileSync } from 'node:child_process';
import Busboy from 'busboy';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config();

function getR2Client(): S3Client | null {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// --- R2 JSON read/write helpers ---

export async function r2ReadJson(key: string): Promise<any> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString();
  if (!body) throw new Error(`Empty body for R2 key: ${key}`);
  return JSON.parse(body);
}

export async function r2WriteJson(key: string, data: unknown, cacheControl = 'no-cache'): Promise<void> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    CacheControl: cacheControl,
  }));
}

export async function r2DeleteKey(key: string): Promise<void> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function r2PutFile(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}

export async function r2ListKeys(prefix: string): Promise<string[]> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

export async function r2StorageBytes(prefix: string): Promise<{ totalBytes: number; objectCount: number }> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  let totalBytes = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents ?? []) {
      totalBytes += obj.Size ?? 0;
      objectCount += 1;
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return { totalBytes, objectCount };
}

// --- Setlist cascading update helper ---

type SetlistEntryTransform = (entry: { type: string; songId?: string; label?: string }) =>
  | { type: string; songId?: string; label?: string }
  | null; // null = remove entry

async function updateSetlistEntries(bandId: string, transform: SetlistEntryTransform): Promise<void> {
  const allKeys = await r2ListKeys(`${bandId}/setlists/`);
  const setlistKeys = allKeys.filter((k) => k.endsWith('.json') && !k.endsWith('/index.json'));

  for (const key of setlistKeys) {
    try {
      const setlist = await r2ReadJson(key);
      if (!Array.isArray(setlist.entries)) continue;

      const updated = setlist.entries
        .map((e: any) => transform(e))
        .filter((e: any) => e !== null);

      if (updated.length !== setlist.entries.length || JSON.stringify(updated) !== JSON.stringify(setlist.entries)) {
        setlist.entries = updated;
        await r2WriteJson(key, setlist);
      }
    } catch {
      // skip setlists that can't be read
    }
  }
}

const TARGET_LUFS = -16;

interface ProbeResult {
  codec: string;
  bitrate: number;
  channels: number;
  sampleRate: number;
}

interface LoudnessInfo {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function ffprobe(filePath: string): ProbeResult {
  const raw = execSync(
    `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(raw);
  const audio = data.streams?.find((s: any) => s.codec_type === 'audio');
  if (!audio) throw new Error('No audio stream found');
  return {
    codec: audio.codec_name ?? '',
    bitrate: parseInt(audio.bit_rate ?? '0', 10),
    channels: audio.channels ?? 0,
    sampleRate: parseInt(audio.sample_rate ?? '0', 10),
  };
}

function measureLoudness(filePath: string): LoudnessInfo {
  const proc = spawnSync('ffmpeg', [
    '-i', filePath,
    '-af', `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ], { encoding: 'utf-8' });

  if (proc.status !== 0) {
    throw new Error(`loudnorm measurement failed: ${proc.stderr?.slice(-500)}`);
  }

  const jsonMatch = proc.stderr.match(/\{[^{}]*"input_i"\s*:[^{}]*\}/s);
  if (!jsonMatch) {
    throw new Error('Could not parse loudnorm JSON from ffmpeg output');
  }
  return JSON.parse(jsonMatch[0]);
}

function transcodeToOpus(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  loudness: LoudnessInfo | undefined,
  normalize: boolean,
): void {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '64k' : '128k';
  const channelFlag = isMono ? '-ac 1' : '';

  let filterFlag: string;
  if (!normalize) {
    filterFlag = '';
  } else if (loudness && parseFloat(loudness.input_i) <= 0) {
    filterFlag = `-af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
  } else {
    filterFlag = `-af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  }

  execSync(
    `ffmpeg -y -i "${inputPath}" ${filterFlag} -codec:a libopus -b:a ${bitrate} ${channelFlag} -ar 48000 -vbr on "${outputPath}"`,
    { stdio: 'ignore' },
  );
}

/**
 * Resolve the MuseScore CLI binary. Honors `MUSESCORE_BIN` env override
 * first, then tries `mscore` on `PATH`, then the default macOS install
 * location. Returns `null` if none of those are runnable, so callers
 * can surface a clear error rather than spawn-failing with ENOENT.
 */
function resolveMscoreBin(): string | null {
  const candidates: string[] = [];
  if (process.env.MUSESCORE_BIN) candidates.push(process.env.MUSESCORE_BIN);
  candidates.push('mscore');
  candidates.push('/Applications/MuseScore 4.app/Contents/MacOS/mscore');
  for (const bin of candidates) {
    try {
      // `-v` prints version and exits 0 when the binary is reachable.
      // Suppress all output; we only care about the exit status.
      execFileSync(bin, ['-v'], { stdio: 'ignore' });
      return bin;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function configApiPlugin(): Plugin {
  return {
    name: 'config-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        // --- POST /api/bands/{bandId}/songs/{songId}/config ---
        const configMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)\/config$/);
        if (configMatch && req.method === 'POST') {
          const bandId = configMatch[1];
          const songId = configMatch[2];

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { songConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (songConfigSchema as any).parse(body);
            await r2WriteJson(`${bandId}/songs/${songId}/config.json`, validated);
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/songs/{songId}/lyrics ---
        const lyricsMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)\/lyrics$/);
        if (lyricsMatch && req.method === 'POST') {
          const bandId = lyricsMatch[1];
          const songId = lyricsMatch[2];

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { lyricsDataSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (lyricsDataSchema as any).parse(body);
            await r2WriteJson(`${bandId}/songs/${songId}/lyrics.json`, validated);
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/songs/{songId}/notes ---
        const notesMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)\/notes$/);
        if (notesMatch && req.method === 'POST') {
          const bandId = notesMatch[1];
          const songId = notesMatch[2];

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { notesDataSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (notesDataSchema as any).parse(body);
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
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/songs/{songId}/rename ---
        const renameMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)\/rename$/);
        if (renameMatch && req.method === 'POST') {
          const bandId = renameMatch[1];
          const oldId = renameMatch[2];

          try {
            const raw = await readBody(req);
            const { newId } = JSON.parse(raw) as { newId: string };

            if (!newId || oldId === newId) {
              return jsonResponse(res, 200, { ok: true, noChange: true });
            }

            // Conflict check against R2 discography
            const discography = await r2ReadJson(`${bandId}/songs/discography.json`);
            if (discography.songs.some((s: any) => s.id === newId)) {
              return jsonResponse(res, 409, { error: `Song ID "${newId}" already exists` });
            }

            // Also check R2 directory — discography may be clean but orphaned
            // files under the target prefix would be silently overwritten by
            // the copy step below.
            const existingAtTarget = await r2ListKeys(`${bandId}/songs/${newId}/`);
            if (existingAtTarget.length > 0) {
              return jsonResponse(res, 409, {
                error: `R2 directory for "${newId}" is not empty (${existingAtTarget.length} file(s)). Clean it up before renaming.`,
              });
            }

            // 1. Copy song config to new key on R2
            const r2 = getR2Client();
            const bucket = process.env.R2_BUCKET;
            if (r2 && bucket) {
              // Copy config.json
              try {
                const oldConfig = await r2ReadJson(`${bandId}/songs/${oldId}/config.json`);
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
                await r2.send(new CopyObjectCommand({
                  Bucket: bucket,
                  CopySource: `${bucket}/${key}`,
                  Key: `${newAudioPrefix}${filename}`,
                }));
              }
              for (const key of audioKeys) {
                await r2DeleteKey(key);
              }
            }

            // 3. Update discography.json
            const entry = discography.songs.find((s: any) => s.id === oldId);
            if (entry) {
              entry.id = newId;
              if (entry.audioBasePath) {
                entry.audioBasePath = entry.audioBasePath.replace(`songs/${oldId}`, `songs/${newId}`);
              }
            }
            await r2WriteJson(`${bandId}/songs/discography.json`, discography);

            // 4. Update songId in any setlists
            await updateSetlistEntries(bandId, (entry) =>
              entry.type === 'song' && entry.songId === oldId
                ? { ...entry, songId: newId }
                : entry,
            );

            jsonResponse(res, 200, { ok: true, newId });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Rename failed' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/logo ---
        const logoMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/logo$/);
        if (logoMatch && req.method === 'POST') {
          const bandId = logoMatch[1];

          try {
            const result = await new Promise<{ buffer: Buffer; ext: string }>((resolve, reject) => {
              const busboy = Busboy({ headers: req.headers as Record<string, string> });
              const chunks: Buffer[] = [];
              let ext = '.png';

              busboy.on('file', (_fieldname, fileStream, info) => {
                ext = path.extname(info.filename).toLowerCase() || '.png';
                fileStream.on('data', (chunk: Buffer) => chunks.push(chunk));
                fileStream.on('end', () => resolve({ buffer: Buffer.concat(chunks), ext }));
                fileStream.on('error', reject);
              });

              busboy.on('error', reject);
              req.pipe(busboy);
            });

            const contentType = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.svg': 'image/svg+xml',
            }[result.ext] ?? 'application/octet-stream';

            const key = `${bandId}/assets/logo${result.ext}`;
            await r2PutFile(key, result.buffer, contentType, 'public, max-age=86400');

            const logoUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
            jsonResponse(res, 200, { ok: true, path: logoUrl });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Upload failed' });
          }
          return;
        }

        // --- POST /api/r2/transcode-upload/{bandId}/{songId} ---
        // Split path / query first so the path-only regex doesn't have to
        // tolerate `?normalize=…` etc.
        const [transcodePathname, transcodeQuery = ''] = (req.url ?? '').split('?');
        const transcodeMatch = transcodePathname.match(/^\/api\/r2\/transcode-upload\/([^/]+)\/([^/]+)$/);
        if (transcodeMatch && req.method === 'POST') {
          const bandId = transcodeMatch[1];
          const songId = transcodeMatch[2];
          const transcodeParams = new URLSearchParams(transcodeQuery);
          // Default to true so existing callers (older clients, scripts)
          // keep the historical loudnorm behavior.
          const normalize = transcodeParams.get('normalize') !== '0';
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;
          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          const r2Prefix = `${bandId}/songs/${songId}`;
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-transcode-'));

          try {
            // 1. Receive files via busboy → temp dir. Alignment offsets are NOT
            // baked in anymore — they live in config.json and are applied at
            // playback time by StemPlayer. The opus files on R2 are authoritative
            // and unmodified.
            const received = await new Promise<{ origName: string; tmpPath: string }[]>((resolve, reject) => {
              const files: { origName: string; tmpPath: string }[] = [];
              const writePromises: Promise<void>[] = [];
              const busboy = Busboy({ headers: req.headers as Record<string, string> });

              busboy.on('file', (_field, stream, info) => {
                const tmpPath = path.join(tmpDir, info.filename);
                const ws = fs.createWriteStream(tmpPath);
                stream.pipe(ws);
                writePromises.push(new Promise<void>((res, rej) => {
                  ws.on('finish', () => { files.push({ origName: info.filename, tmpPath }); res(); });
                  ws.on('error', rej);
                }));
              });

              busboy.on('finish', () => {
                Promise.all(writePromises).then(() => resolve(files)).catch(reject);
              });
              busboy.on('error', reject);
              req.pipe(busboy);
            });

            // 2. Transcode each file and upload to R2
            const fileMap: Record<string, string> = {}; // origName → transcoded name

            for (const { origName, tmpPath } of received) {
              const probe = ffprobe(tmpPath);

              let loudness: LoudnessInfo | undefined;
              if (normalize) {
                try {
                  loudness = measureLoudness(tmpPath);
                } catch (err: any) {
                  console.warn(`Loudness measurement failed for ${origName}, transcoding without normalization:`, err.message);
                }
              }

              const baseName = path.basename(origName, path.extname(origName));
              const uploadName = `${baseName}.opus`;
              const uploadPath = path.join(tmpDir, `out-${uploadName}`);
              transcodeToOpus(tmpPath, uploadPath, probe, loudness, normalize);

              // Upload to R2
              const key = `${r2Prefix}/${uploadName}`;
              const body = fs.readFileSync(uploadPath);
              await r2.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: 'audio/opus',
                CacheControl: 'public, max-age=31536000, immutable',
              }));

              fileMap[origName] = uploadName;
            }

            const publicBase = `${process.env.R2_PUBLIC_URL}/${r2Prefix}`;
            jsonResponse(res, 200, { ok: true, fileMap, publicBase });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Transcode/upload failed' });
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
          return;
        }

        // --- POST /api/r2/mscz-convert-upload/{bandId}/{songId} ---
        // Accepts a multipart upload with a single `.mscz` file (field
        // name `sheetMusic`), shells out to the MuseScore CLI to
        // convert it to MXL, and uploads the result as `score.mxl` to
        // R2 — same canonical filename as the presign+PUT path for
        // `.musicxml` / `.xml` / `.mxl`, so InfiniteScoreRenderer picks
        // it up with no changes.
        // Split path from query before matching — `[^/]+` in the path
        // regex would otherwise swallow `?filename=...` into the songId
        // capture (the `?` character isn't a path separator).
        const [msczPathname, msczQuery = ''] = (req.url ?? '').split('?');
        const msczMatch = msczPathname.match(/^\/api\/r2\/mscz-convert-upload\/([^/]+)\/([^/]+)$/);
        if (msczMatch && req.method === 'POST') {
          const bandId = msczMatch[1];
          const songId = msczMatch[2];
          // Target filename for the R2 key. Client sends it as a
          // `?filename=<kebab>.mxl` query param; we re-validate here
          // to refuse anything bad (path traversal, wrong extension,
          // oversized). Falls back to `score.mxl` if the param is
          // absent, matching the pre-sanitization callers.
          const params = new URLSearchParams(msczQuery);
          const rawFilename = params.get('filename') ?? 'score.mxl';
          if (!/^[a-z0-9-]{1,40}\.mxl$/.test(rawFilename)) {
            return jsonResponse(res, 400, {
              error: `Invalid filename "${rawFilename}" — expected [a-z0-9-]{1,40}.mxl`,
            });
          }
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;
          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          const mscoreBin = resolveMscoreBin();
          if (!mscoreBin) {
            return jsonResponse(res, 500, {
              error:
                'MuseScore CLI not found. Install MuseScore 4 (macOS: https://musescore.org), ' +
                'set MUSESCORE_BIN to the binary path, or symlink `mscore` onto PATH.',
            });
          }

          const r2Prefix = `${bandId}/songs/${songId}`;
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mscz-'));
          // Cap uploads at 50 MB so a bad client can't fill /tmp.
          const MAX_BYTES = 50 * 1024 * 1024;

          try {
            // 1. Receive the .mscz via busboy → temp dir.
            const received = await new Promise<{ origName: string; tmpPath: string }>((resolve, reject) => {
              let file: { origName: string; tmpPath: string } | null = null;
              let writePromise: Promise<void> | null = null;
              let sizeExceeded = false;
              const busboy = Busboy({
                headers: req.headers as Record<string, string>,
                limits: { files: 1, fileSize: MAX_BYTES },
              });

              busboy.on('file', (_field, stream, info) => {
                const safeName = path.basename(info.filename || 'upload.mscz');
                const tmpPath = path.join(tmpDir, safeName);
                const ws = fs.createWriteStream(tmpPath);
                stream.on('limit', () => { sizeExceeded = true; });
                stream.pipe(ws);
                writePromise = new Promise<void>((res, rej) => {
                  ws.on('finish', () => {
                    file = { origName: safeName, tmpPath };
                    res();
                  });
                  ws.on('error', rej);
                });
              });

              busboy.on('finish', () => {
                if (sizeExceeded) {
                  reject(new Error(`Upload exceeds ${MAX_BYTES} bytes`));
                  return;
                }
                (writePromise ?? Promise.resolve()).then(() => {
                  if (!file) reject(new Error('No file in upload'));
                  else resolve(file);
                }).catch(reject);
              });
              busboy.on('error', reject);
              req.pipe(busboy);
            });

            // 2. Sanity-check extension so we don't feed MuseScore
            // random binaries. The client already filters this, but
            // an attacker hitting the API directly would bypass that.
            const ext = path.extname(received.origName).toLowerCase();
            if (ext !== '.mscz') {
              return jsonResponse(res, 400, { error: `Expected .mscz upload, got "${received.origName}"` });
            }

            // 3. Run mscore -o <out>.mxl <in>.mscz.
            const outPath = path.join(tmpDir, rawFilename);
            try {
              execFileSync(mscoreBin, ['-o', outPath, received.tmpPath], {
                stdio: 'ignore',
                // MuseScore spins up Qt; give it enough time for a
                // reasonably large score. 60 s is plenty for the
                // 93-measure Wiggle sample (~1 s in practice).
                timeout: 60_000,
              });
            } catch (err: any) {
              throw new Error(`MuseScore conversion failed: ${err.message ?? err}`);
            }

            if (!fs.existsSync(outPath)) {
              throw new Error('MuseScore ran but produced no output file');
            }

            // 4. Upload the MXL to R2 under the target filename.
            const filename = rawFilename;
            const key = `${r2Prefix}/${filename}`;
            const body = fs.readFileSync(outPath);
            await r2.send(new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: body,
              ContentType: 'application/vnd.recordare.musicxml',
              CacheControl: 'public, max-age=31536000, immutable',
            }));

            jsonResponse(res, 200, { ok: true, filename });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'MSCZ convert/upload failed' });
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
          return;
        }

        // --- POST /api/r2/presign ---
        if (req.url === '/api/r2/presign' && req.method === 'POST') {
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;
          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          try {
            const raw = await readBody(req);
            const { bandId, songId, files } = JSON.parse(raw) as { bandId: string; songId: string; files: string[] };
            if (!bandId || !songId || !files?.length) {
              return jsonResponse(res, 400, { error: 'bandId, songId and files[] required' });
            }

            const r2Prefix = `${bandId}/songs/${songId}`;
            const urls: Record<string, string> = {};
            for (const filename of files) {
              const key = `${r2Prefix}/${filename}`;
              const url = await getSignedUrl(r2, new PutObjectCommand({
                Bucket: bucket,
                Key: key,
              }), { expiresIn: 3600 });
              urls[filename] = url;
            }

            jsonResponse(res, 200, { urls, publicBase: `${process.env.R2_PUBLIC_URL}/${r2Prefix}` });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Presign failed' });
          }
          return;
        }

        // --- POST /api/registry/rebuild --- (re)build slim registry from band.json files
        if (req.url === '/api/registry/rebuild' && req.method === 'POST') {
          try {
            let oldRegistry: any = { bands: [] };
            try {
              oldRegistry = await r2ReadJson('registry.json');
            } catch {
              // registry may not exist yet
            }

            const bandIds: string[] = Array.from(
              new Set((oldRegistry.bands ?? []).map((b: any) => b.id)),
            );
            const slim: any[] = [];

            for (const id of bandIds) {
              let full: any;
              try {
                full = await r2ReadJson(`${id}/band.json`);
              } catch {
                // Seed band.json from the old (pre-split) registry entry if it
                // still has full color data. After this runs once, subsequent
                // rebuilds read straight from band.json.
                const old = (oldRegistry.bands ?? []).find((b: any) => b.id === id);
                if (!old?.colors) continue;
                full = {
                  id: old.id,
                  name: old.name,
                  route: old.route,
                  colors: old.colors,
                };
                if (old.logo) full.logo = old.logo;
                await r2WriteJson(`${id}/band.json`, full);
              }

              const entry: any = {
                id: full.id,
                name: full.name,
                route: full.route,
                background: full.colors.background,
                text: full.colors.text,
              };
              if (full.logo) entry.logo = full.logo;
              slim.push(entry);
            }

            await r2WriteJson('registry.json', { bands: slim });
            jsonResponse(res, 200, { ok: true, count: slim.length });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Rebuild failed' });
          }
          return;
        }

        // --- GET /api/bands/{bandId}/storage ---
        const storageMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/storage$/);
        if (storageMatch && req.method === 'GET') {
          const bandId = storageMatch[1];
          try {
            const { totalBytes, objectCount } = await r2StorageBytes(`${bandId}/`);
            jsonResponse(res, 200, { totalBytes, objectCount });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Storage lookup failed' });
          }
          return;
        }

        // --- PUT /api/bands/{bandId} --- upsert a single band
        const bandPutMatch = req.url?.match(/^\/api\/bands\/([^/]+)$/);
        if (bandPutMatch && req.method === 'PUT') {
          const bandId = bandPutMatch[1];
          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { bandConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (bandConfigSchema as any).parse(body);

            if (validated.id !== bandId) {
              return jsonResponse(res, 400, {
                error: `URL band id "${bandId}" doesn't match body id "${validated.id}"`,
              });
            }

            // 1. Write the authoritative per-band file.
            await r2WriteJson(`${bandId}/band.json`, validated);

            // 2. Upsert the slim entry in registry.json.
            let registry: any = { bands: [] };
            let isNewBand = true;
            try {
              registry = await r2ReadJson('registry.json');
              isNewBand = !(registry.bands ?? []).some((b: any) => b.id === bandId);
            } catch {
              // registry may not exist yet
            }
            const entry: any = {
              id: validated.id,
              name: validated.name,
              route: validated.route,
              background: validated.colors.background,
              text: validated.colors.text,
            };
            if (validated.logo) entry.logo = validated.logo;

            registry.bands = (registry.bands ?? [])
              .filter((b: any) => b.id !== bandId)
              .map(({ songIds: _omit, ...rest }: any) => rest);
            registry.bands.push(entry);
            await r2WriteJson('registry.json', registry);

            // 3. Seed blank setlists index for a new band.
            if (isNewBand) {
              try {
                await r2ReadJson(`${bandId}/setlists/index.json`);
              } catch {
                await r2WriteJson(`${bandId}/setlists/index.json`, { setlists: [] });
              }
            }

            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- DELETE /api/bands/{bandId} ---
        const bandDeleteMatch = req.url?.match(/^\/api\/bands\/([^/]+)$/);
        if (bandDeleteMatch && req.method === 'DELETE') {
          const bandId = bandDeleteMatch[1];

          try {
            // 1. Delete all R2 keys under the band's prefix (songs, setlists, assets, etc.)
            try {
              const keys = await r2ListKeys(`${bandId}/`);
              for (const key of keys) {
                try {
                  await r2DeleteKey(key);
                } catch {
                  // individual key failure shouldn't abort the cascade
                }
              }
            } catch {
              // prefix may be empty
            }

            // 2. Remove band from registry.json (and strip any legacy songIds fields)
            try {
              const registry = await r2ReadJson('registry.json');
              registry.bands = (registry.bands ?? [])
                .filter((b: any) => b.id !== bandId)
                .map(({ songIds: _omit, ...rest }: any) => rest);
              await r2WriteJson('registry.json', registry);
            } catch {
              // registry may not exist
            }

            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Delete band failed' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/songs/discography ---
        const discographyMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/discography$/);
        if (discographyMatch && req.method === 'POST') {
          const bandId = discographyMatch[1];

          try {
            const raw = await readBody(req);
            const { overwrite, ...entry } = JSON.parse(raw) as { overwrite?: boolean; id: string; [k: string]: any };

            let discography: { songs: any[] };
            try {
              discography = await r2ReadJson(`${bandId}/songs/discography.json`);
            } catch (err: any) {
              // Only treat missing-object as empty discography. Re-throw
              // transient/network errors so we never wipe an existing file.
              if (err?.name === 'NoSuchKey' || err?.Code === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
                discography = { songs: [] };
              } else {
                throw err;
              }
            }

            const exists = discography.songs.some((s: any) => s.id === entry.id);
            if (exists && !overwrite) {
              return jsonResponse(res, 409, {
                error: `Song id "${entry.id}" already exists. Delete it first or pick a different title/artist.`,
              });
            }

            // Upsert entry
            discography.songs = discography.songs.filter((s: any) => s.id !== entry.id);
            discography.songs.push(entry);

            await r2WriteJson(`${bandId}/songs/discography.json`, discography);
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- DELETE /api/bands/{bandId}/songs/{songId} ---
        const deleteMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          const bandId = deleteMatch[1];
          const songId = deleteMatch[2];

          try {
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
              const discography = await r2ReadJson(`${bandId}/songs/discography.json`);
              discography.songs = discography.songs.filter((s: any) => s.id !== songId);
              await r2WriteJson(`${bandId}/songs/discography.json`, discography);
            } catch {
              // discography may not exist
            }

            // 4. Remove song from any setlists
            await updateSetlistEntries(bandId, (entry) =>
              entry.type === 'song' && entry.songId === songId ? null : entry,
            );

            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Delete failed' });
          }
          return;
        }

        // --- DELETE /api/bands/{bandId}/songs/{songId}/file/{filename} ---
        // Removes a single file within a song's folder. Used by the Edit
        // Song save handler to clean up orphaned sheet-music files when
        // the user removes or replaces the score.
        const fileDeleteMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/songs\/([^/]+)\/file\/([^/]+)$/);
        if (fileDeleteMatch && req.method === 'DELETE') {
          const bandId = fileDeleteMatch[1];
          const songId = fileDeleteMatch[2];
          const filename = decodeURIComponent(fileDeleteMatch[3]);
          // Reject anything that looks like a path — we only delete
          // direct children of the song's R2 folder.
          if (!filename || filename.includes('/') || filename.includes('..')) {
            return jsonResponse(res, 400, { error: 'Invalid filename' });
          }
          try {
            await r2DeleteKey(`${bandId}/songs/${songId}/${filename}`);
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Delete failed' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/setlists/{setlistId} ---
        const setlistSaveMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/setlists\/([^/]+)$/);
        if (setlistSaveMatch && req.method === 'POST') {
          const bandId = setlistSaveMatch[1];
          const setlistId = setlistSaveMatch[2];

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { setlistConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (setlistConfigSchema as any).parse(body);

            await r2WriteJson(`${bandId}/setlists/${setlistId}.json`, validated);

            // Update setlist index
            let index: { setlists: { id: string; slug?: string; name: string }[] } = { setlists: [] };
            try {
              index = await r2ReadJson(`${bandId}/setlists/index.json`);
            } catch {
              // index doesn't exist yet
            }

            index.setlists = index.setlists.filter((s) => s.id !== setlistId);
            index.setlists.push({
              id: setlistId,
              ...(validated.slug ? { slug: validated.slug } : {}),
              name: validated.name,
            });
            await r2WriteJson(`${bandId}/setlists/index.json`, index);

            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Save setlist failed' });
          }
          return;
        }

        // --- DELETE /api/bands/{bandId}/setlists/{setlistId} ---
        const setlistDeleteMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/setlists\/([^/]+)$/);
        if (setlistDeleteMatch && req.method === 'DELETE') {
          const bandId = setlistDeleteMatch[1];
          const setlistId = setlistDeleteMatch[2];

          try {
            await r2DeleteKey(`${bandId}/setlists/${setlistId}.json`);

            let index: { setlists: { id: string; slug?: string; name: string }[] } = { setlists: [] };
            try {
              index = await r2ReadJson(`${bandId}/setlists/index.json`);
            } catch {
              // no index
            }

            index.setlists = index.setlists.filter((s) => s.id !== setlistId);
            await r2WriteJson(`${bandId}/setlists/index.json`, index);

            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Delete setlist failed' });
          }
          return;
        }

        next();
      });
    },
  };
}
