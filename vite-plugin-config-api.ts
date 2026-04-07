import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
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

async function r2ReadJson(key: string): Promise<any> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString();
  if (!body) throw new Error(`Empty body for R2 key: ${key}`);
  return JSON.parse(body);
}

async function r2WriteJson(key: string, data: unknown, cacheControl = 'no-cache'): Promise<void> {
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

async function r2DeleteKey(key: string): Promise<void> {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

async function r2PutFile(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
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

async function r2ListKeys(prefix: string): Promise<string[]> {
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

function resolveBandForSong(songId: string): string | null {
  const bandsPath = path.resolve(process.cwd(), 'public', 'bands.json');
  if (!fs.existsSync(bandsPath)) return null;
  const bands = JSON.parse(fs.readFileSync(bandsPath, 'utf-8')).bands;
  return bands.find((b: any) => b.songIds.includes(songId))?.id ?? null;
}

function songDirPath(songId: string): string {
  const bandId = resolveBandForSong(songId);
  const base = path.resolve(process.cwd(), 'public', 'audio');
  return bandId ? path.join(base, bandId, `song-${songId}`) : path.join(base, `song-${songId}`);
}

function r2SongPrefix(songId: string): string {
  const bandId = resolveBandForSong(songId);
  return bandId ? `${bandId}/song-${songId}` : `song-${songId}`;
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

function transcodeToMp3(
  inputPath: string,
  outputPath: string,
  probe: ProbeResult,
  loudness?: LoudnessInfo,
): void {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '128k' : '256k';
  const channelFlag = isMono ? '-ac 1' : '';
  let filterFlag = '';
  if (loudness) {
    filterFlag = `-af loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true`;
  }
  execSync(
    `ffmpeg -y -i "${inputPath}" ${filterFlag} -codec:a libmp3lame -b:a ${bitrate} ${channelFlag} -ar 44100 "${outputPath}"`,
    { stdio: 'ignore' },
  );
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
        // --- POST /api/song/{songId}/config ---
        const configMatch = req.url?.match(/^\/api\/song\/([^/]+)\/config$/);
        if (configMatch && req.method === 'POST') {
          const songId = configMatch[1];
          const songDir = songDirPath(songId);

          fs.mkdirSync(songDir, { recursive: true });

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { songConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (songConfigSchema as any).parse(body);
            const configPath = path.join(songDir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify(validated, null, 2) + '\n');
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- POST /api/song/{songId}/rename ---
        const renameMatch = req.url?.match(/^\/api\/song\/([^/]+)\/rename$/);
        if (renameMatch && req.method === 'POST') {
          const oldId = renameMatch[1];

          try {
            const raw = await readBody(req);
            const { newId } = JSON.parse(raw) as { newId: string };

            if (!newId || oldId === newId) {
              return jsonResponse(res, 200, { ok: true, noChange: true });
            }

            // Conflict check
            const manifestPath = path.resolve(process.cwd(), 'public', 'audio', 'manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (manifest.songs.some((s: any) => s.id === newId)) {
              return jsonResponse(res, 409, { error: `Song ID "${newId}" already exists` });
            }

            // 1. Rename local directory
            const oldDir = songDirPath(oldId);
            const newDir = oldDir.replace(`song-${oldId}`, `song-${newId}`);
            if (fs.existsSync(oldDir)) {
              fs.renameSync(oldDir, newDir);
            }

            // 2. Patch config.json id field
            const configPath = path.join(newDir, 'config.json');
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              config.id = newId;
              fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
            }

            // 3. Copy R2 objects from old prefix to new prefix, then delete old
            const r2 = getR2Client();
            const bucket = process.env.R2_BUCKET;
            if (r2 && bucket) {
              const oldPrefix = `${r2SongPrefix(oldId)}/`;
              // Compute new prefix before updating bands.json (resolveBandForSong still finds old ID)
              const bandId = resolveBandForSong(oldId);
              const newPrefix = bandId ? `${bandId}/song-${newId}/` : `song-${newId}/`;

              const objectKeys: string[] = [];
              let continuationToken: string | undefined;
              do {
                const list = await r2.send(new ListObjectsV2Command({
                  Bucket: bucket,
                  Prefix: oldPrefix,
                  ContinuationToken: continuationToken,
                }));
                for (const obj of list.Contents ?? []) {
                  if (obj.Key) objectKeys.push(obj.Key);
                }
                continuationToken = list.NextContinuationToken;
              } while (continuationToken);

              // Copy to new prefix
              for (const key of objectKeys) {
                const filename = key.slice(oldPrefix.length);
                await r2.send(new CopyObjectCommand({
                  Bucket: bucket,
                  CopySource: `${bucket}/${key}`,
                  Key: `${newPrefix}${filename}`,
                }));
              }

              // Delete old objects
              for (const key of objectKeys) {
                await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
              }
            }

            // 4. Update manifest.json
            const entry = manifest.songs.find((s: any) => s.id === oldId);
            if (entry) {
              entry.id = newId;
              entry.path = entry.path.replace(`song-${oldId}`, `song-${newId}`);
              if (entry.audioBasePath) {
                entry.audioBasePath = entry.audioBasePath.replace(`song-${oldId}`, `song-${newId}`);
              }
            }
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

            // 5. Update bands.json
            const bandsPath = path.resolve(process.cwd(), 'public', 'bands.json');
            const bandsData = JSON.parse(fs.readFileSync(bandsPath, 'utf-8'));
            for (const band of bandsData.bands) {
              band.songIds = band.songIds.map((id: string) => id === oldId ? newId : id);
            }
            fs.writeFileSync(bandsPath, JSON.stringify(bandsData, null, 2) + '\n');

            jsonResponse(res, 200, { ok: true, newId });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Rename failed' });
          }
          return;
        }

        // --- POST /api/song/{songId}/upload ---
        const uploadMatch = req.url?.match(/^\/api\/song\/([^/]+)\/upload$/);
        if (uploadMatch && req.method === 'POST') {
          const songId = uploadMatch[1];
          const songDir = songDirPath(songId);

          fs.mkdirSync(songDir, { recursive: true });

          try {
            const files = await new Promise<string[]>((resolve, reject) => {
              const written: string[] = [];
              const busboy = Busboy({ headers: req.headers as Record<string, string> });

              busboy.on('file', (_fieldname, fileStream, info) => {
                const filePath = path.join(songDir, info.filename);
                const writeStream = fs.createWriteStream(filePath);
                fileStream.pipe(writeStream);
                writeStream.on('finish', () => written.push(info.filename));
                writeStream.on('error', reject);
              });

              busboy.on('finish', () => resolve(written));
              busboy.on('error', reject);
              req.pipe(busboy);
            });

            jsonResponse(res, 200, { ok: true, files });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Upload failed' });
          }
          return;
        }

        // --- POST /api/bands/{bandId}/logo ---
        const logoMatch = req.url?.match(/^\/api\/bands\/([^/]+)\/logo$/);
        if (logoMatch && req.method === 'POST') {
          const bandId = logoMatch[1];
          const bandDir = path.resolve(process.cwd(), 'public', 'bands', bandId);
          fs.mkdirSync(bandDir, { recursive: true });

          try {
            const result = await new Promise<{ filename: string }>((resolve, reject) => {
              const busboy = Busboy({ headers: req.headers as Record<string, string> });

              busboy.on('file', (_fieldname, fileStream, info) => {
                // Remove any existing logo files
                for (const ext of ['png', 'jpg', 'jpeg', 'svg']) {
                  const old = path.join(bandDir, `logo.${ext}`);
                  if (fs.existsSync(old)) fs.unlinkSync(old);
                }

                const ext = path.extname(info.filename).toLowerCase() || '.png';
                const filename = `logo${ext}`;
                const filePath = path.join(bandDir, filename);
                const writeStream = fs.createWriteStream(filePath);
                fileStream.pipe(writeStream);
                writeStream.on('finish', () => resolve({ filename }));
                writeStream.on('error', reject);
              });

              busboy.on('error', reject);
              req.pipe(busboy);
            });

            const logoPath = `/bands/${bandId}/${result.filename}`;
            jsonResponse(res, 200, { ok: true, path: logoPath });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Upload failed' });
          }
          return;
        }

        // --- POST /api/r2/transcode-upload ---
        const transcodeMatch = req.url?.match(/^\/api\/r2\/transcode-upload\/([^/]+)$/);
        if (transcodeMatch && req.method === 'POST') {
          const songId = transcodeMatch[1];
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;
          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-transcode-'));

          try {
            // 1. Receive files via busboy → temp dir
            const received = await new Promise<{ origName: string; tmpPath: string }[]>((resolve, reject) => {
              const files: { origName: string; tmpPath: string }[] = [];
              const busboy = Busboy({ headers: req.headers as Record<string, string> });

              busboy.on('file', (_field, stream, info) => {
                const tmpPath = path.join(tmpDir, info.filename);
                const ws = fs.createWriteStream(tmpPath);
                stream.pipe(ws);
                ws.on('finish', () => files.push({ origName: info.filename, tmpPath }));
                ws.on('error', reject);
              });

              busboy.on('finish', () => resolve(files));
              busboy.on('error', reject);
              req.pipe(busboy);
            });

            // 2. Transcode each file and upload to R2
            const fileMap: Record<string, string> = {}; // origName → transcoded name

            for (const { origName, tmpPath } of received) {
              const probe = ffprobe(tmpPath);

              let loudness: LoudnessInfo | undefined;
              try {
                loudness = measureLoudness(tmpPath);
              } catch (err: any) {
                console.warn(`Loudness measurement failed for ${origName}, transcoding without normalization:`, err.message);
              }

              const baseName = path.basename(origName, path.extname(origName));
              const uploadName = `${baseName}.mp3`;
              const uploadPath = path.join(tmpDir, `out-${uploadName}`);
              transcodeToMp3(tmpPath, uploadPath, probe, loudness);

              // Upload to R2
              const key = `${r2SongPrefix(songId)}/${uploadName}`;
              const body = fs.readFileSync(uploadPath);
              await r2.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: 'audio/mpeg',
                CacheControl: 'public, max-age=31536000, immutable',
              }));

              fileMap[origName] = uploadName;
            }

            const publicBase = `${process.env.R2_PUBLIC_URL}/${r2SongPrefix(songId)}`;
            jsonResponse(res, 200, { ok: true, fileMap, publicBase });
          } catch (err: any) {
            jsonResponse(res, 500, { error: err.message ?? 'Transcode/upload failed' });
          } finally {
            // Clean up temp dir
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
            const { songId, files } = JSON.parse(raw) as { songId: string; files: string[] };
            if (!songId || !files?.length) {
              return jsonResponse(res, 400, { error: 'songId and files[] required' });
            }

            const urls: Record<string, string> = {};
            for (const filename of files) {
              const key = `${r2SongPrefix(songId)}/${filename}`;
              const url = await getSignedUrl(r2, new PutObjectCommand({
                Bucket: bucket,
                Key: key,
              }), { expiresIn: 3600 });
              urls[filename] = url;
            }

            jsonResponse(res, 200, { urls, publicBase: `${process.env.R2_PUBLIC_URL}/${r2SongPrefix(songId)}` });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Presign failed' });
          }
          return;
        }

        // --- POST /api/bands ---
        if (req.url === '/api/bands' && req.method === 'POST') {
          const bandsPath = path.resolve(process.cwd(), 'public', 'bands.json');

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { bandsManifestSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (bandsManifestSchema as any).parse(body);
            fs.writeFileSync(bandsPath, JSON.stringify(validated, null, 2) + '\n');
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- POST /api/manifest/add ---
        if (req.url === '/api/manifest/add' && req.method === 'POST') {
          const manifestPath = path.resolve(process.cwd(), 'public', 'audio', 'manifest.json');

          try {
            const raw = await readBody(req);
            const entry = JSON.parse(raw);
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

            // Avoid duplicate entries
            manifest.songs = manifest.songs.filter((s: any) => s.id !== entry.id);
            manifest.songs.push(entry);

            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
            jsonResponse(res, 200, { ok: true });
          } catch (err: any) {
            jsonResponse(res, 400, { error: err.message ?? 'Invalid request' });
          }
          return;
        }

        // --- DELETE /api/song/{songId} ---
        const deleteMatch = req.url?.match(/^\/api\/song\/([^/]+)$/);
        if (deleteMatch && req.method === 'DELETE') {
          const songId = deleteMatch[1];

          try {
            // 1. Delete from R2
            const r2 = getR2Client();
            const bucket = process.env.R2_BUCKET;
            if (r2 && bucket) {
              const prefix = `${r2SongPrefix(songId)}/`;
              let continuationToken: string | undefined;
              do {
                const list = await r2.send(new ListObjectsV2Command({
                  Bucket: bucket,
                  Prefix: prefix,
                  ContinuationToken: continuationToken,
                }));
                for (const obj of list.Contents ?? []) {
                  if (obj.Key) {
                    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
                  }
                }
                continuationToken = list.NextContinuationToken;
              } while (continuationToken);
            }

            // 2. Delete local song directory
            const songDir = songDirPath(songId);
            if (fs.existsSync(songDir)) {
              fs.rmSync(songDir, { recursive: true, force: true });
            }

            // 3. Remove from manifest.json
            const manifestPath = path.resolve(process.cwd(), 'public', 'audio', 'manifest.json');
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            manifest.songs = manifest.songs.filter((s: any) => s.id !== songId);
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

            // 4. Remove from all bands in bands.json
            const bandsPath = path.resolve(process.cwd(), 'public', 'bands.json');
            const bandsData = JSON.parse(fs.readFileSync(bandsPath, 'utf-8'));
            for (const band of bandsData.bands) {
              band.songIds = band.songIds.filter((id: string) => id !== songId);
            }
            fs.writeFileSync(bandsPath, JSON.stringify(bandsData, null, 2) + '\n');

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
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;

          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          try {
            const raw = await readBody(req);
            const body = JSON.parse(raw);
            const { setlistConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
            const validated = (setlistConfigSchema as any).parse(body);

            // Upload setlist JSON to R2
            const setlistKey = `${bandId}/setlists/${setlistId}.json`;
            await r2.send(new PutObjectCommand({
              Bucket: bucket,
              Key: setlistKey,
              Body: JSON.stringify(validated, null, 2),
              ContentType: 'application/json',
              CacheControl: 'no-cache',
            }));

            // Read existing index.json from R2 (or start fresh)
            const indexKey = `${bandId}/setlists/index.json`;
            let index: { setlists: { id: string; name: string }[] } = { setlists: [] };
            try {
              const existing = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: indexKey }));
              const indexBody = await existing.Body?.transformToString();
              if (indexBody) index = JSON.parse(indexBody);
            } catch {
              // index.json doesn't exist yet — use empty
            }

            // Upsert entry
            index.setlists = index.setlists.filter((s) => s.id !== setlistId);
            index.setlists.push({ id: setlistId, name: validated.name });

            // Upload updated index
            await r2.send(new PutObjectCommand({
              Bucket: bucket,
              Key: indexKey,
              Body: JSON.stringify(index, null, 2),
              ContentType: 'application/json',
              CacheControl: 'no-cache',
            }));

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
          const r2 = getR2Client();
          const bucket = process.env.R2_BUCKET;

          if (!r2 || !bucket) {
            return jsonResponse(res, 500, { error: 'R2 not configured — check .env' });
          }

          try {
            // Delete setlist JSON from R2
            const setlistKey = `${bandId}/setlists/${setlistId}.json`;
            await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: setlistKey }));

            // Update index.json
            const indexKey = `${bandId}/setlists/index.json`;
            let index: { setlists: { id: string; name: string }[] } = { setlists: [] };
            try {
              const existing = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: indexKey }));
              const indexBody = await existing.Body?.transformToString();
              if (indexBody) index = JSON.parse(indexBody);
            } catch {
              // no index — nothing to update
            }

            index.setlists = index.setlists.filter((s) => s.id !== setlistId);

            await r2.send(new PutObjectCommand({
              Bucket: bucket,
              Key: indexKey,
              Body: JSON.stringify(index, null, 2),
              ContentType: 'application/json',
              CacheControl: 'no-cache',
            }));

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
