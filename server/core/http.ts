import type { CoreResponse } from './types';

/**
 * Thrown by a handler that wants a specific status code. Anything else a
 * handler throws falls back to the route's `errorStatus`.
 */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * The `message` of a thrown value, without asserting it's an `Error`.
 * Returns `undefined` when there is none, so callers can `??` a fallback —
 * and preserves an empty-string message rather than replacing it.
 */
export function errorMessage(err: unknown): unknown {
  return (err as { message?: unknown } | null | undefined)?.message;
}

/** `200 {"ok": true, ...extra}` — the shape almost every write route returns. */
export function ok(extra: Record<string, unknown> = {}): CoreResponse {
  return { status: 200, body: { ok: true, ...extra } };
}

/** `200` with an arbitrary body (reads that aren't `{ok:true}`-shaped). */
export function json(body: unknown): CoreResponse {
  return { status: 200, body };
}
