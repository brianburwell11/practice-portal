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

export interface CoreRequest {
  /** Named captures from the route pattern. Untrusted — treat as client input. */
  params: Record<string, string>;
  query: URLSearchParams;
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
  body: unknown;
}

export type CoreHandler = (req: CoreRequest) => Promise<CoreResponse>;

/** Everything known about a request before its body has been read. */
export type RouteTarget = Pick<CoreRequest, 'params' | 'query'>;

/** The parts of a `CoreRequest` that only exist once the body is read. */
export type RequestBody = Pick<CoreRequest, 'body' | 'files' | 'tmpDir'>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RouteDef {
  /**
   * Stable identifier for the route. Used in logs today; Phase 6 hangs the
   * required capability off this same table.
   */
  name: string;
  method: HttpMethod;
  /** Matched against the pathname only. Named groups become `CoreRequest.params`. */
  pattern: RegExp;
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
