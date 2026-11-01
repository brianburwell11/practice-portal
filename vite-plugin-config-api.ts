/**
 * Vite dev-server adapter for the API core.
 *
 * All business logic lives in `server/core/` as framework-agnostic handlers,
 * and the Node request/response plumbing lives in `server/adapters/nodeApi.ts`
 * — shared with the standalone server in `server/main.ts`. Access rules are
 * the same here as on Fly: sign in to edit (Phase 6c).
 */
import type { Plugin, ViteDevServer } from 'vite';
import dotenv from 'dotenv';
import { createApiHandler } from './server/adapters/nodeApi';
import { startWorker, stopWorker } from './server/core/jobs/worker';

// The core reads R2 credentials and DATABASE_URL from `process.env` lazily,
// so loading `.env` here is enough. Without DATABASE_URL nobody can sign in,
// so every route but the public reads refuses (Phase 6c).
dotenv.config();

// A dropped connection (the laptop slept, Neon closed an idle socket) can
// surface as a promise nobody awaits. Node would exit; in dev, say so and
// keep serving. Once per process: this file is re-evaluated on every restart.
const DEV_REJECTION_HOOK = Symbol.for('practice-portal.devRejectionHook');
const g = globalThis as Record<symbol, unknown>;
if (!g[DEV_REJECTION_HOOK]) {
  g[DEV_REJECTION_HOOK] = true;
  process.on('unhandledRejection', (reason) => {
    console.error('[dev] unhandled rejection (kept running):', reason);
  });
}

export function configApiPlugin(): Plugin {
  return {
    name: 'config-api',
    configureServer(server: ViteDevServer) {
      const handleApi = createApiHandler();
      // The same background worker as production, so stem uploads finish in
      // dev. It shares the job table with production — SKIP LOCKED keeps the
      // two from taking the same job. WORKER=off disables it.
      startWorker();
      server.middlewares.use(async (req, res, next) => {
        if (!(await handleApi(req, res))) next();
      });
    },
    // Vite re-evaluates this file on every restart (a .env or config change),
    // and each copy starts its own worker. Stop this one as its server closes,
    // or they pile up, all polling the database.
    closeBundle() {
      stopWorker();
    },
  };
}
