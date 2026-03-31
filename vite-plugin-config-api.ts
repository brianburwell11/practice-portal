import type { Plugin, ViteDevServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export function configApiPlugin(): Plugin {
  return {
    name: 'config-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/song\/([^/]+)\/config$/);
        if (!match || req.method !== 'POST') {
          return next();
        }

        const songId = match[1];
        const songDir = path.resolve(process.cwd(), 'public', 'audio', `song-${songId}`);

        if (!fs.existsSync(songDir)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Song directory song-${songId} not found` }));
          return;
        }

        try {
          const raw = await readBody(req);
          const body = JSON.parse(raw);

          const { songConfigSchema } = await server.ssrLoadModule('/src/config/schema.ts');
          const validated = (songConfigSchema as any).parse(body);

          const configPath = path.join(songDir, 'config.json');
          fs.writeFileSync(configPath, JSON.stringify(validated, null, 2) + '\n');

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message ?? 'Invalid request' }));
        }
      });
    },
  };
}
