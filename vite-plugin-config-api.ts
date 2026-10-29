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
import { startWorker } from './server/core/jobs/worker';

// The core reads R2 credentials and DATABASE_URL from `process.env` lazily,
// so loading `.env` here is enough. Without DATABASE_URL nobody can sign in,
// so every route but the public reads refuses (Phase 6c).
dotenv.config();

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
  };
}
