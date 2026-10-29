/**
 * Stem uploads through the job queue (Phase 9). The browser:
 *
 *   1. `POST …/stems` — one job per stem, each with a presigned PUT to
 *      `_incoming/<jobId>/<name>` in R2;
 *   2. uploads every raw file straight to R2 — never through this server;
 *   3. `POST …/stems/queue` — the uploads are done; the worker takes over;
 *   4. polls `GET …/stems?jobs=…` for per-stem progress, retrying a failed
 *      one with `POST …/stems/:jobId/retry`.
 *
 * Every route needs `song.audio.write` in the band, and only sees that band's
 * jobs for that song.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { bandByLegacyId, type BandRef } from '../auth/can';
import { HttpError, json, ok } from '../http';
import { INCOMING_PREFIX, wakeWorker, type TranscodePayload } from '../jobs/worker';
import { r2HeadSize, r2PresignPut, r2PublicUrl } from '../r2';
import type { CoreRequest, CoreResponse } from '../types';
import { audit } from './members';

const MAX_STEMS = 32;
/** Per raw file. A 10-minute 24-bit stereo WAV is about 170 MB. */
export const MAX_STEM_BYTES = 1024 * 1024 * 1024;
const AUDIO_EXT = /\.(wav|flac|aiff?|mp3|m4a|aac|ogg|opus)$/i;
const STEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** This song's jobs in this band, by id. */
const songJobs = (band: BandRef, songId: string, ids: string[]) => and(
  inArray(schema.job.id, ids),
  eq(schema.job.bandId, band.id),
  sql`${schema.job.payload}->>'songId' = ${songId}`,
);

const UUID = /^[0-9a-f-]{36}$/i;

function jobIds(raw: unknown): string[] {
  const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const clean = ids.map(String).filter((id) => UUID.test(id));
  if (!clean.length || clean.length > MAX_STEMS) throw new HttpError(400, `Between 1 and ${MAX_STEMS} job ids, please`);
  return clean;
}

/**
 * `POST /api/bands/:bandId/songs/:songId/stems`
 * `{ files: [{ stemId, filename, size }], normalize? }`
 * → `{ jobs: [{ id, stemId, uploadUrl }], publicBase }` — `publicBase` is where the song's audio is served from.
 */
export async function createStemUploads(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const { songId } = req.params;
  const { files, normalize } = (req.body ?? {}) as { files?: unknown; normalize?: unknown };
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_STEMS) {
    throw new HttpError(400, `Send between 1 and ${MAX_STEMS} stems`);
  }
  const stems = files.map((f) => {
    const { stemId, filename, size } = (f ?? {}) as { stemId?: unknown; filename?: unknown; size?: unknown };
    if (typeof stemId !== 'string' || !STEM_ID.test(stemId)) throw new HttpError(400, 'Each stem needs an id of letters, digits, - or _');
    const name = typeof filename === 'string' ? path.basename(filename) : '';
    if (!AUDIO_EXT.test(name)) throw new HttpError(400, `"${name || '?'}" isn’t an audio file this can read`);
    if (typeof size !== 'number' || size <= 0) throw new HttpError(400, `"${name}" is empty`);
    if (size > MAX_STEM_BYTES) throw new HttpError(400, `"${name}" is over ${MAX_STEM_BYTES / 1024 ** 3} GB`);
    return { stemId, name };
  });
  if (new Set(stems.map((s) => s.stemId)).size !== stems.length) throw new HttpError(400, 'Two stems share an id');

  const created = stems.map(({ stemId, name }) => {
    const id = randomUUID();
    // The key keeps only the extension: the original name can be anything.
    const rawKey = `${INCOMING_PREFIX}${id}/raw${path.extname(name).toLowerCase()}`;
    const payload: TranscodePayload = { songId, stemId, rawKey, filename: name, normalize: normalize !== false };
    return { id, payload };
  });
  await db().insert(schema.job).values(created.map(({ id, payload }) => ({
    id, kind: 'transcode_stem', bandId: band.id, createdBy: req.actor?.userId ?? null, payload,
  })));
  const jobs = await Promise.all(created.map(async ({ id, payload }) => ({
    id, stemId: payload.stemId, uploadUrl: await r2PresignPut(payload.rawKey, 6 * 60 * 60),
  })));
  return json({ jobs, publicBase: `${r2PublicUrl()}/${band.legacyId}/songs/${songId}` });
}

/** `POST …/stems/queue` `{ jobIds }` — every raw file is in R2; hand them to the worker. */
export async function queueStemUploads(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const ids = jobIds((req.body as { jobIds?: unknown } | undefined)?.jobIds);
  const rows = await db().select().from(schema.job).where(songJobs(band, req.params.songId, ids));
  if (rows.length !== ids.length) throw new HttpError(404, 'Some of those uploads aren’t this song’s');

  const waiting = rows.filter((r) => r.status === 'uploading');
  const missing: string[] = [];
  for (const row of waiting) {
    if ((await r2HeadSize((row.payload as TranscodePayload).rawKey)) === null) {
      missing.push((row.payload as TranscodePayload).filename);
    }
  }
  if (missing.length) throw new HttpError(400, `Not uploaded yet: ${missing.join(', ')}`);

  if (waiting.length) {
    await db().transaction(async (tx) => {
      await tx.update(schema.job).set({ status: 'queued', updatedAt: new Date() })
        .where(and(inArray(schema.job.id, waiting.map((r) => r.id)), eq(schema.job.status, 'uploading')));
      if (req.actor) {
        await audit(tx, band, req.actor, 'song.audio.upload', req.params.songId,
          { stems: waiting.map((r) => (r.payload as TranscodePayload).stemId) });
      }
    });
    wakeWorker();
  }
  return ok({ queued: waiting.length });
}

/** `GET …/stems?jobs=a,b` — where each stem stands. */
export async function getStemJobs(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const ids = jobIds(req.query.get('jobs'));
  const rows = await db().select().from(schema.job).where(songJobs(band, req.params.songId, ids));
  return json({
    jobs: rows.map((r) => ({
      id: r.id,
      stemId: (r.payload as TranscodePayload).stemId,
      filename: (r.payload as TranscodePayload).filename,
      status: r.status,
      progress: r.progress,
      error: r.error,
      file: (r.result as { file?: string } | null)?.file ?? null,
    })),
  });
}

/** `POST …/stems/:jobId/retry` — a failed stem goes back in the queue, if its upload is still there. */
export async function retryStemJob(req: CoreRequest): Promise<CoreResponse> {
  const band = await bandByLegacyId(req.params.bandId);
  const [row] = await db().select().from(schema.job).where(songJobs(band, req.params.songId, jobIds([req.params.jobId])));
  if (!row) throw new HttpError(404, 'No such upload for this song');
  if (row.status !== 'failed') throw new HttpError(409, `It’s ${row.status}, not failed`);
  if ((await r2HeadSize((row.payload as TranscodePayload).rawKey)) === null) {
    throw new HttpError(410, 'The upload is gone — add the file again');
  }
  await db().update(schema.job)
    .set({ status: 'queued', attempts: 0, progress: 0, error: null, finishedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.job.id, row.id), eq(schema.job.status, 'failed')));
  wakeWorker();
  return ok();
}
