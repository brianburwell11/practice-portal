/**
 * Node `http` adapter for the API core, shared by every Node host: the Vite
 * dev middleware and the standalone server in `server/main.ts`.
 *
 * It does one job: turn an `IncomingMessage` into a `CoreRequest`, hand it to
 * the matched route, and write the `CoreResponse` back.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCookies } from '../core/auth/cookies';
import { GUEST_COOKIE, guestTokens, resolveGuests, type GuestGrant } from '../core/auth/guests';
import { resolveSession, SESSION_COOKIE } from '../core/auth/sessions';
import { matchRoute, runRoute } from '../core/router';
import type { Actor, CoreResponse, RequestBody, RouteDef } from '../core/types';
import {
  makeScratchDir,
  readBody,
  readMultipart,
  removeScratchDir,
} from './nodeRequest';

function setHeaders(res: ServerResponse, headers: CoreResponse['headers']): void {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value) && value.length === 0) continue;
    res.setHeader(name, value);
  }
}

export function sendJson(res: ServerResponse, { status, body, headers }: CoreResponse): void {
  res.statusCode = status;
  setHeaders(res, headers);
  if (status >= 300 && status < 400) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * `https://host[:port]` as the browser addressed us. Fly terminates TLS and
 * says so in X-Forwarded-Proto; the Vite dev server serves HTTPS itself —
 * over HTTP/2, which has no Host header, only the `:authority` pseudo-header.
 * Missing that once turned `https://localhost:5173` into `https://localhost`.
 */
export function requestOrigin(req: Pick<IncomingMessage, 'headers' | 'socket'>): string {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwarded || ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? 'https' : 'http');
  const host = req.headers.host ?? req.headers[':authority'];
  return `${proto}://${typeof host === 'string' && host ? host : 'localhost'}`;
}

async function resolveGuestCookie(cookies: Record<string, string>): Promise<GuestGrant[]> {
  const tokens = guestTokens(cookies[GUEST_COOKIE]);
  if (!tokens.length || !process.env.DATABASE_URL) return [];
  try {
    return await resolveGuests(tokens);
  } catch (err) {
    console.error('[auth] guest link lookup failed:', err);
    return [];
  }
}

async function resolveActor(cookies: Record<string, string>): Promise<Actor | undefined> {
  const token = cookies[SESSION_COOKIE];
  if (!token || !process.env.DATABASE_URL) return undefined;
  try {
    return await resolveSession(token);
  } catch (err) {
    // A database hiccup makes this request anonymous rather than failing it.
    console.error('[auth] session lookup failed:', err);
    return undefined;
  }
}

/**
 * A successful read, revalidated on every use — the same `no-cache` R2 sets
 * on its JSON — with an ETag so an unchanged document costs a 304, not a body.
 */
function sendCacheableJson(req: IncomingMessage, res: ServerResponse, { status, body, headers }: CoreResponse, personal: boolean): void {
  const text = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(text).digest('base64url')}"`;
  setHeaders(res, headers);
  res.setHeader('Content-Type', 'application/json');
  // A signed-in or guest response may differ per person, so no shared cache may keep it.
  res.setHeader('Cache-Control', personal ? 'private, no-cache' : 'no-cache');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.statusCode = status;
  res.end(text);
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

/**
 * Returns a handler that resolves `true` if it answered the request, or
 * `false` if no route matched and the caller should fall through.
 */
export function createApiHandler() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const [pathname, search = ''] = (req.url ?? '').split('?');
    const matched = matchRoute(req.method ?? '', pathname);
    if (!matched) return false;

    const { route, params } = matched;
    const cookies = parseCookies(req.headers.cookie);
    const origin = requestOrigin(req);

    // Cross-site request forgery: a state-changing request that carries our
    // session cookie must come from our own pages. SameSite=Lax already stops
    // browsers attaching the cookie cross-site; this closes the gap for
    // same-site-but-other-origin requests and older browsers.
    if (req.method !== 'GET' && req.method !== 'HEAD' && cookies[SESSION_COOKIE]
        && req.headers.origin !== origin) {
      sendJson(res, { status: 403, body: { error: 'Cross-origin request refused' } });
      return true;
    }

    const actor = await resolveActor(cookies);
    const guests = await resolveGuestCookie(cookies);

    const query = new URLSearchParams(search);
    const tmpDir = route.body === 'multipart'
      ? makeScratchDir(`pp-${route.name}-`)
      : undefined;

    try {
      const response = await runRoute(route, { params, query, cookies, origin, actor, guests }, () =>
        loadBody(req, route, tmpDir),
      );
      if (route.method === 'GET' && response.status === 200) {
        sendCacheableJson(req, res, response, !!(cookies[SESSION_COOKIE] || cookies[GUEST_COOKIE]));
      } else {
        sendJson(res, response);
      }
    } finally {
      if (tmpDir) removeScratchDir(tmpDir);
    }
    return true;
  };
}
