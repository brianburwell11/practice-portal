/**
 * Node `http` adapter for the API core, shared by every Node host: the Vite
 * dev middleware and the standalone server in `server/main.ts`.
 *
 * It does one job: turn an `IncomingMessage` into a `CoreRequest`, hand it to
 * the matched route, and write the `CoreResponse` back.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { matchRoute, runRoute } from '../core/router';
import type { CoreResponse, RequestBody, RouteDef } from '../core/types';
import {
  makeScratchDir,
  readBody,
  readMultipart,
  removeScratchDir,
} from './nodeRequest';

export function sendJson(res: ServerResponse, { status, body }: CoreResponse): void {
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

export interface ApiHandlerOptions {
  /**
   * Gate a matched route before anything else happens. Return a response to
   * refuse it — the body is never read, so a refused upload costs nothing.
   * Phase 6's capability check replaces this.
   */
  gate?: (route: RouteDef) => CoreResponse | undefined;
}

/**
 * Returns a handler that resolves `true` if it answered the request, or
 * `false` if no route matched and the caller should fall through.
 */
export function createApiHandler({ gate }: ApiHandlerOptions = {}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const [pathname, search = ''] = (req.url ?? '').split('?');
    const matched = matchRoute(req.method ?? '', pathname);
    if (!matched) return false;

    const { route, params } = matched;
    const refused = gate?.(route);
    if (refused) {
      sendJson(res, refused);
      return true;
    }

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
    return true;
  };
}
