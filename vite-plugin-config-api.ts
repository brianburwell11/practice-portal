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
import { mirrorDelete, mirrorWrite } from './server/core/documents';
import { setJsonMirror } from './server/core/r2';

// The core reads R2 credentials from `process.env` lazily, so loading `.env`
// here is enough — no other module needs to know where env came from.
dotenv.config();

// Phase 4: R2 is still where the admin writes, and production reads from
// Postgres. Mirror every JSON write so the two stay in step. Without a
// database the admin still works, but the hosted site stops seeing edits.
if (process.env.DATABASE_URL) {
  setJsonMirror({ write: mirrorWrite, delete: mirrorDelete });
} else {
  console.warn('[config-api] DATABASE_URL not set — admin edits will not reach Postgres or the hosted site.');
}

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
