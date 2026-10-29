import { DrizzleQueryError } from 'drizzle-orm';
import { ZodError } from 'zod';
import { authorizeAccess } from './access';
import { auditWrite, inRequestTransaction } from './store';
import { HttpError, errorMessage } from './http';
import { routes } from './routes';
import type { CoreResponse, HttpMethod, RequestBody, RouteDef, RouteTarget } from './types';

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

/**
 * First route whose method and pathname match, in declaration order.
 * Pathname only — the caller strips the query string.
 */
export function matchRoute(method: string, pathname: string): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== (method as HttpMethod)) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;
    return { route, params: { ...match.groups } as Record<string, string> };
  }
  return null;
}

/**
 * Run a matched route, turning thrown errors into a `CoreResponse`.
 *
 * Order is deliberate: the route's `precheck` runs before `loadBody`, so a
 * request that can be rejected on its path or query alone never streams an
 * upload to disk. `loadBody` runs inside the same error envelope as the
 * handler, so a malformed body or an oversized upload reports the route's own
 * error shape rather than escaping into the adapter.
 */
export async function runRoute(
  route: RouteDef,
  target: RouteTarget,
  loadBody: () => Promise<RequestBody>,
): Promise<CoreResponse> {
  try {
    // Authorization first: an anonymous caller learns nothing, not even
    // whether R2 is configured, and no upload is read before it passes.
    await authorizeAccess(route.access, target);
    await route.authorizePath?.(target);
    route.precheck?.(target);
    const req = { ...target, ...(await loadBody()) };
    await route.authorizeBody?.(req);
    if (route.writes === 'documents') {
      return await inRequestTransaction(route, req.params, req.actor, () => route.handler(req));
    }
    const response = await route.handler(req);
    if (route.writes === 'media' && response.status < 400) await auditWrite(route, req.params, req.actor);
    return response;
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status, body: { error: err.message } };
    }
    // Validation: say what's wrong, briefly.
    if (err instanceof ZodError) {
      const issues = err.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
      return { status: 400, body: { error: `Invalid request. ${issues.join('; ')}` } };
    }
    // A database error's message carries the SQL and its parameters: log it, never send it.
    if (err instanceof DrizzleQueryError || (err as { name?: string })?.name === 'PostgresError') {
      console.error(`[${route.name}] database error:`, err);
      return { status: 500, body: { error: route.errorMessage ?? 'Request failed' } };
    }
    return {
      status: route.errorStatus ?? 500,
      body: { error: errorMessage(err) ?? route.errorMessage ?? 'Request failed' },
    };
  }
}
