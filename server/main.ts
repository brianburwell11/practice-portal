/**
 * Standalone server for the cloud deployment (Phase 3).
 *
 * Serves the built SPA and mounts the same API core the Vite dev server uses,
 * but **read-only**: every API route is refused before its body is read,
 * except routes marked `public` — today only `GET /api/data/*`, the JSON
 * documents R2 already serves to anyone (Phase 4). The admin UI isn't in the
 * production bundle (it's gated on `import.meta.env.DEV`). Admin keeps
 * working as before via `npm run dev` on a laptop with R2 credentials.
 *
 * Being a GET isn't enough: the band storage route runs a full R2 listing,
 * which unauthenticated would leak bucket layout and hand anyone a way to
 * run up R2 operations once credentials are set. Public is opt-in per route.
 *
 * That gate is the only thing standing between the internet and an
 * unauthenticated API. Phase 6 replaces it with per-route capability checks;
 * don't loosen it before then.
 *
 *   PORT           listen port (default 8080)
 *   STATIC_DIR     SPA build directory (default ./dist)
 *   DATABASE_URL   Postgres, for /api/data
 *   R2_PUBLIC_URL  rebuilds media URLs inside /api/data documents
 */
import http from 'node:http';
import { createApiHandler, sendJson } from './adapters/nodeApi';
import { createStaticHandler } from './adapters/staticFiles';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = process.env.STATIC_DIR ?? 'dist';

const handleApi = createApiHandler({
  gate: (route, actor) => {
    if (route.public) return undefined;
    if (route.signedIn) return actor ? undefined : { status: 401, body: { error: 'Sign in required' } };
    return { status: 403, body: { error: 'This server is read-only' } };
  },
});
const handleStatic = createStaticHandler(STATIC_DIR);

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const pathname = (req.url ?? '/').split('?')[0];

  if (pathname === '/healthz') {
    sendJson(res, { status: 200, body: { status: 'ok' } });
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (!(await handleApi(req, res))) {
      sendJson(res, { status: 404, body: { error: 'Not found' } });
    }
    return;
  }

  handleStatic(req, res);
}

const server = http.createServer((req, res) => {
  const started = performance.now();
  res.on('finish', () => {
    const ms = (performance.now() - started).toFixed(1);
    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
  });

  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, { status: 500, body: { error: 'Internal error' } });
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, () => {
  console.log(`practice-portal listening on :${PORT} (read-only, serving ${STATIC_DIR})`);
});

// Fly sends SIGINT on deploy/stop by default, Docker sends SIGTERM. Stop
// accepting connections and let in-flight requests finish.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
