/**
 * Standalone server for the cloud deployment.
 *
 * Serves the built SPA and mounts the same API core the Vite dev server uses.
 * Who may call each route is declared in `server/core/routes.ts` and enforced
 * by the core router (Phase 6) — identically here and in dev. Routes that
 * write to R2 additionally need R2 credentials, which this server only gets
 * in Phase 8c; until then they fail closed.
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

// Every route declares who may call it, and the core router enforces that
// (Phase 6). Until this server holds R2 write credentials (Phase 8c), the
// routes that touch R2 also fail closed for want of them.
const handleApi = createApiHandler();
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
  console.log(`practice-portal listening on :${PORT} (serving ${STATIC_DIR})`);
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
