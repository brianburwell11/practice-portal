import { readDocument } from '../documents';
import { HttpError, json } from '../http';
import type { CoreRequest, CoreResponse } from '../types';

/**
 * `GET /api/data/<R2 key>` — the JSON document R2 holds at that key, served
 * from Postgres. Same shape, same 404s, so the SPA only changes its base URL.
 * Members-only bands answer only their members (401 signed out, 403 not a
 * member).
 */
export async function readData(req: CoreRequest): Promise<CoreResponse> {
  const doc = await readDocument(req.params.key, undefined, req.actor?.userId);
  if (doc === null) throw new HttpError(404, 'Not found');
  return json(doc);
}
