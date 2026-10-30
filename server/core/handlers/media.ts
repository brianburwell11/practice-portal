import { isPlatformAdmin } from '../access';
import { canReadBandMedia } from '../documents';
import { HttpError } from '../http';
import { r2PresignGet } from '../r2';
import type { CoreRequest, CoreResponse } from '../types';

/**
 * `GET /api/media/<R2 key>` — a band's audio, scores and logo (Phase 7).
 * The bucket is private: this checks the viewer may read the band, as
 * `/api/data` does, then redirects to a presigned R2 URL. `R2_PUBLIC_URL`
 * points here, so every media URL the app builds comes through this gate.
 *
 * A logo is shown to anyone who has the band's address (the sign-in and
 * request-to-join pages, emails), so `<band>/assets/` skips the check.
 * JSON documents aren't media: they're served by `/api/data`.
 */
export async function readMedia(req: CoreRequest): Promise<CoreResponse> {
  let key: string;
  try {
    key = decodeURIComponent(req.params.key);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  const [band, folder] = key.split('/');
  if (!folder || key.endsWith('.json') || key.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new HttpError(404, 'Not found');
  }
  const viewer = folder === 'assets'
    ? { siteAdmin: true }
    : { userId: req.actor?.userId, guestBandIds: req.guests?.map((g) => g.bandId), siteAdmin: isPlatformAdmin(req.actor) };
  if (!(await canReadBandMedia(band, viewer))) throw new HttpError(404, 'Not found');

  return {
    status: 302,
    body: null,
    headers: {
      Location: await r2PresignGet(key),
      // Reuse the redirect for an hour; its target is good for at least six.
      'Cache-Control': 'private, max-age=3600',
    },
  };
}
