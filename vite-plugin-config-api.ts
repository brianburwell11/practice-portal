/**
 * Vite dev-server adapter for the API core.
 *
 * All business logic lives in `server/core/` as framework-agnostic handlers.
 * This file does one job: turn a Node `IncomingMessage` into a `CoreRequest`,
 * hand it to the matched route, and write the `CoreResponse` back. The Phase 3
 * standalone server mounts the exact same core, which is why this stays thin.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import dotenv from 'dotenv';
import { matchRoute, runRoute } from './server/core/router';
import type { CoreResponse, RequestBody, RouteDef } from './server/core/types';
import {
  makeScratchDir,
  readBody,
  readMultipart,
  removeScratchDir,
} from './server/adapters/nodeRequest';

// The core reads R2 credentials from `process.env` lazily, so loading `.env`
// here is enough — no other module needs to know where env came from.
dotenv.config();

function sendJson(res: ServerResponse, { status, body }: CoreResponse): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Read the body in whatever shape the route declared. Multipart routes stream
 * into `tmpDir`, which the caller removes once the response is written.
 */
async function loadBody(
  req: IncomingMessage,
  route: RouteDef,
  tmpDir: string | undefined,
): Promise<RequestBody> {
  switch (route.body) {
    case 'json':
      return { body: JSON.parse(await readBody(req)) };
    case 'multipart':
      return { files: await readMultipart(req, tmpDir!, route.limits), tmpDir };
    default:
      return {};
  }
}

export function configApiPlugin(): Plugin {
  return {
    name: 'config-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const [pathname, search = ''] = (req.url ?? '').split('?');
        const matched = matchRoute(req.method ?? '', pathname);
        if (!matched) return next();

        const { route, params } = matched;
        const query = new URLSearchParams(search);
        const tmpDir = route.body === 'multipart'
          ? makeScratchDir(`pp-${route.name}-`)
          : undefined;

        try {
          sendJson(res, await runRoute(route, { params, query }, () =>
            loadBody(req, route, tmpDir),
          ));
        } finally {
          if (tmpDir) removeScratchDir(tmpDir);
        }
      });
    },
  };
}
