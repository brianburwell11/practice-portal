import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import Busboy from 'busboy';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

interface ProbeResult {
  codec: string;
  bitrate: number;
  channels: number;
  sampleRate: number;
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

function shouldSkipTranscode(probe: ProbeResult): boolean {
  return probe.codec === 'mp3' && probe.bitrate >= 256000;
}

function transcodeToMp3(inputPath: string, outputPath: string, probe: ProbeResult): void {
  // Mono stems get 128k (equivalent quality to 256k stereo)
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '128k' : '256k';
  const channelFlag = isMono ? '-ac 1' : '';
  execSync(
    `ffmpeg -y -i "${inputPath}" -codec:a libmp3lame -b:a ${bitrate} ${channelFlag} -ar 44100 "${outputPath}"`,
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
          const songDir = path.resolve(process.cwd(), 'public', 'audio', `song-${songId}`);

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

        // --- POST /api/song/{songId}/upload ---
        const uploadMatch = req.url?.match(/^\/api\/song\/([^/]+)\/upload$/);
        if (uploadMatch && req.method === 'POST') {
          const songId = uploadMatch[1];
          const songDir = path.resolve(process.cwd(), 'public', 'audio', `song-${songId}`);

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
              let uploadPath = tmpPath;
              let uploadName = origName;

              const probe = ffprobe(tmpPath);

              if (shouldSkipTranscode(probe)) {
                // Already MP3 ≥256k, upload as-is
                uploadName = origName;
              } else {
                // Transcode to MP3
                const baseName = path.basename(origName, path.extname(origName));
                uploadName = `${baseName}.mp3`;
                uploadPath = path.join(tmpDir, `out-${uploadName}`);
                transcodeToMp3(tmpPath, uploadPath, probe);
              }

              // Upload to R2
              const key = `song-${songId}/${uploadName}`;
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

            const publicBase = `${process.env.R2_PUBLIC_URL}/song-${songId}`;
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
              const key = `song-${songId}/${filename}`;
              const url = await getSignedUrl(r2, new PutObjectCommand({
                Bucket: bucket,
                Key: key,
              }), { expiresIn: 3600 });
              urls[filename] = url;
            }

            jsonResponse(res, 200, { urls, publicBase: `${process.env.R2_PUBLIC_URL}/song-${songId}` });
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

        next();
      });
    },
  };
}
