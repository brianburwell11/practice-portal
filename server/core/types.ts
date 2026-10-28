/**
 * Framework-agnostic request/response contract for the API core.
 *
 * Handlers here never see `req`/`res`. An *adapter* (the Vite dev
 * middleware today, a real HTTP server later) is responsible for:
 *   - matching the route,
 *   - reading the body into `body` / streaming uploads into `files`,
 *   - serializing `CoreResponse` back onto the wire.
 */

/** A file received on a multipart request, already streamed to disk by the adapter. */
export interface UploadedFile {
  fieldName: string;
  /** Sanitized basename of the client-supplied filename. */
  filename: string;
  /** Absolute path inside the request's scratch directory. */
  path: string;
}

/** Who is calling. Resolved by the adapter from the session cookie. */
export interface Actor {
  kind: 'user';
  userId: string;
  email: string;
  /** Hash of the session token, so sign-out can end exactly this session. */
  sessionHash: string;
}

export interface CoreRequest {
  /** Named captures from the route pattern. Untrusted — treat as client input. */
  params: Record<string, string>;
  query: URLSearchParams;
  /** Request cookies, by name. */
  cookies: Record<string, string>;
  /**
   * `https://host[:port]` as the browser addressed this server. Used to build
   * OAuth redirect URIs; Google rejects any it wasn't configured with, so a
   * spoofed Host header can't redirect a sign-in elsewhere.
   */
  origin: string;
  /** The signed-in user, or undefined for an anonymous request. */
  actor?: Actor;
  /**
   * Live guest links this device holds (`pp_guest`), signed in or not. Read
   * access to their bands only — never consulted by a write.
   */
  guests?: GuestGrant[];
  /** Parsed JSON body. Present when the route declares `body: 'json'`. */
  body?: unknown;
  /** Uploads. Present when the route declares `body: 'multipart'`. */
  files?: UploadedFile[];
  /**
   * Scratch directory owned by the adapter, created for multipart routes.
   * Handlers may write intermediates here; the adapter removes it after
   * the response is produced.
   */
  tmpDir?: string;
}

export interface CoreResponse {
  status: number;
  /** Serialized as JSON. Omitted for redirects. */
  body: unknown;
  /** Extra response headers — `Location` for a redirect, `Set-Cookie`. */
  headers?: Record<string, string | string[]>;
}

export type CoreHandler = (req: CoreRequest) => Promise<CoreResponse>;

/** Everything known about a request before its body has been read. */
export type RouteTarget = Pick<CoreRequest, 'params' | 'query' | 'cookies' | 'origin' | 'actor' | 'guests'>;

/** The parts of a `CoreRequest` that only exist once the body is read. */
export type RequestBody = Pick<CoreRequest, 'body' | 'files' | 'tmpDir'>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

import type { Access } from './access';
import type { GuestGrant } from './auth/guests';

export interface RouteDef {
  /**
   * Stable identifier for the route. Used in logs today; Phase 6 hangs the
   * required capability off this same table.
   */
  name: string;
  method: HttpMethod;
  /** Matched against the pathname only. Named groups become `CoreRequest.params`. */
  pattern: RegExp;
  /** Who may call this route. Required — see `access.ts`. */
  access: Access;
  /** A finer check from the path alone; runs before any upload is read. */
  authorizePath?: (target: RouteTarget) => Promise<void>;
  /** A finer check that needs the parsed JSON body. */
  authorizeBody?: (req: CoreRequest) => Promise<void>;
  /**
   * What a write route changes — required on every non-GET route:
   *   'documents'  JSON documents: one Postgres transaction with its audit
   *                row, R2 copied after commit (store.ts)
   *   'media'      R2 objects only; audited once it succeeds, outside any
   *                transaction (a transcode takes minutes)
   *   'self'       manages its own transaction and audit (members, auth)
   */
  writes?: 'documents' | 'media' | 'self';
  /** How the adapter should read the body. Defaults to `'none'`. */
  body?: 'none' | 'json' | 'multipart';
  /** Enforced by the adapter while parsing a multipart body. */
  limits?: { files?: number; fileSize?: number };
  /**
   * Validation that must run *before* the body is read: a bad path param,
   * query param, or missing configuration shouldn't cost a 50 MB upload
   * first. Throw to reject. Phase 6's capability check belongs here too.
   */
  precheck?: (target: RouteTarget) => void;
  handler: CoreHandler;
  /** Status for an unexpected throw. `HttpError` always wins over this. */
  errorStatus?: number;
  /** Message for a thrown error that carries none. */
  errorMessage?: string;
}
