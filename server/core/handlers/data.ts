import { isPlatformAdmin } from '../access';
import { memo, viewerKey } from '../cache';
import { readDocument } from '../documents';
import { HttpError, json } from '../http';
import type { CoreRequest, CoreResponse } from '../types';

/**
 * `GET /api/data/<R2 key>` — the JSON document R2 holds at that key, served
 * from Postgres. Same shape, same 404s, so the SPA only changes its base URL.
 * Members-only bands answer only their members and guest-link holders (401
 * signed out, 403 not a member).
 */
export async function readData(req: CoreRequest): Promise<CoreResponse> {
  const viewer = {
    userId: req.actor?.userId,
    guestBandIds: req.guests?.map((g) => g.bandId),
    siteAdmin: isPlatformAdmin(req.actor),
  };
  // Cached briefly per document and viewer (server/core/cache.ts).
  const key = req.params.key;
  const doc = await memo(`doc:${viewerKey(viewer)}:${key}`, () => readDocument(key, undefined, viewer));
  if (doc === null) throw new HttpError(404, 'Not found');
  return json(doc);
}
