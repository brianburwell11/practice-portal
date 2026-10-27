/**
 * Vite dev-server adapter for the API core.
 *
 * All business logic lives in `server/core/` as framework-agnostic handlers,
 * and the Node request/response plumbing lives in `server/adapters/nodeApi.ts`
 * — shared with the standalone server in `server/main.ts`. Locally every route
 * is open; this is the admin surface.
 */
import type { Plugin, ViteDevServer } from 'vite';
import dotenv from 'dotenv';
import { createApiHandler } from './server/adapters/nodeApi';

// The core reads R2 credentials from `process.env` lazily, so loading `.env`
// here is enough — no other module needs to know where env came from.
dotenv.config();

export function configApiPlugin(): Plugin {
  return {
    name: 'config-api',
    configureServer(server: ViteDevServer) {
      const handleApi = createApiHandler();
      server.middlewares.use(async (req, res, next) => {
        if (!(await handleApi(req, res))) next();
      });
    },
  };
}
