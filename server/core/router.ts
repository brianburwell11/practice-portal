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
    route.precheck?.(target);
    return await route.handler({ ...target, ...(await loadBody()) });
  } catch (err) {
    if (err instanceof HttpError) {
      return { status: err.status, body: { error: err.message } };
    }
    return {
      status: route.errorStatus ?? 500,
      body: { error: errorMessage(err) ?? route.errorMessage ?? 'Request failed' },
    };
  }
}
