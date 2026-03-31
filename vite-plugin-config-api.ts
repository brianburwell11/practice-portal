import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import Busboy from 'busboy';

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

          if (!fs.existsSync(songDir)) {
            return jsonResponse(res, 404, { error: `Song directory song-${songId} not found` });
          }

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
