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
 *   CANONICAL_HOST the one public hostname (practiceportal.app). Requests
 *                  for any other public hostname — practice-portal.fly.dev,
 *                  www — get a 308 to it. Unset: no redirects.
 */
import http from 'node:http';
import { createApiHandler, sendJson } from './adapters/nodeApi';
import { createStaticHandler } from './adapters/staticFiles';
import { pageTitleFor } from './core/pageTitles';
import { startWorker, stopWorker } from './core/jobs/worker';
import { drainEmails } from './core/email';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = process.env.STATIC_DIR ?? 'dist';

// Every route declares who may call it, and the core router enforces that
// (Phase 6). Until this server holds R2 write credentials (Phase 8c), the
// routes that touch R2 also fail closed for want of them.
const handleApi = createApiHandler();
const handleStatic = createStaticHandler(STATIC_DIR, { pageTitle: pageTitleFor });

const CANONICAL_HOST = process.env.CANONICAL_HOST?.trim().toLowerCase() || undefined;

/**
 * Hostnames to send to CANONICAL_HOST. Only names we serve publicly: Fly's
 * health checks and internal traffic arrive by IP or *.internal and must not
 * be redirected. One address means one sign-in — sessions are per hostname.
 */
function redirectsToCanonical(host: string | undefined): boolean {
  if (!CANONICAL_HOST || !host) return false;
  const name = host.split(':')[0].toLowerCase();
  return name !== CANONICAL_HOST && (name.endsWith('.fly.dev') || name === `www.${CANONICAL_HOST}`);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const pathname = (req.url ?? '/').split('?')[0];

  if (pathname === '/healthz') {
    sendJson(res, { status: 200, body: { status: 'ok' } });
    return;
  }

  // 308 keeps the method and body, so a stray POST isn't turned into a GET.
  if (redirectsToCanonical(req.headers.host)) {
    res.statusCode = 308;
    res.setHeader('Location', `https://${CANONICAL_HOST}${req.url ?? '/'}`);
    res.end();
    return;
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (!(await handleApi(req, res))) {
      sendJson(res, { status: 404, body: { error: 'Not found' } });
    }
    return;
  }

  handleStatic(req, res).catch((err) => {
    console.error('[static] failed:', err);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
}

/**
 * A request path fit for the logs: guest-link and invite tokens are secrets
 * that work for whoever holds them, so mask them (the email opt-out link
 * carries an invite token too).
 */
function loggable(url = ''): string {
  return url
    .replace(/([?&]guest=)[^&#]+/, '$1…')
    // The email opt-out link carries the invite's token.
    .replace(/([?&]token=)[^&#]+/, '$1…')
    .replace(/^(\/api\/guest\/|\/api\/invites\/|\/invite\/)[^/?#]+/, '$1…')
    // Sign-in carries where to go next, which may be an invite or guest link.
    .replace(/(next=%2Finvite%2F)[^&#]+/i, '$1…')
    .replace(/(guest%3D)[^&#%]+/i, '$1…');
}

const server = http.createServer((req, res) => {
  const started = performance.now();
  res.on('finish', () => {
    const ms = (performance.now() - started).toFixed(1);
    console.log(`${req.method} ${loggable(req.url)} ${res.statusCode} ${ms}ms`);
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
  // Background jobs (Phase 9) run in this process, one at a time.
  startWorker();
});

// Fly sends SIGINT on deploy/stop by default, Docker sends SIGTERM. Stop
// accepting connections and let in-flight requests finish.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    // A job in hand is abandoned; it goes back to the queue once it's stale.
    stopWorker();
    // Emails sent in the background still go out before the process ends.
    server.close(() => void drainEmails().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
