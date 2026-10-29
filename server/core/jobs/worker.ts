/**
 * The background worker (Phase 9). Runs inside the server process and does
 * one job at a time — on a one-CPU machine, two transcodes at once would
 * only make both slower.
 *
 * A job is claimed with `FOR UPDATE SKIP LOCKED`, so any number of server
 * processes can share the table without two taking the same job. While it
 * works, the worker writes progress and `locked_at`; a `running` job whose
 * `locked_at` goes stale belonged to a process that died (a deploy, a
 * crash) and goes back to the queue.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { ffprobe, measureLoudness, transcodeToOpus, type LoudnessInfo } from '../media/ffmpeg';
import { errorMessage } from '../http';
import { getR2Client, r2DeleteKey, r2DownloadToFile, r2ListKeys, r2PutFile } from '../r2';

type Job = typeof schema.job.$inferSelect;

export interface TranscodePayload {
  songId: string;
  /** The stem's id in the song config; the result is `<stemId>.opus`. */
  stemId: string;
  /** Where the browser uploaded the raw file. */
  rawKey: string;
  /** The name it had on the uploader's computer, for messages. */
  filename: string;
  normalize: boolean;
}

/** Raw uploads live here until their job is done. */
export const INCOMING_PREFIX = '_incoming/';
/** Tries before a job is `failed`, counting the first. */
export const MAX_ATTEMPTS = 3;
/** A running job not heard from in this long is presumed orphaned. */
const STALE_MS = 3 * 60 * 1000;
/** How often an idle worker looks for work (it's also woken directly). */
const POLL_MS = 3000;
/** Write progress at most this often. */
const PROGRESS_MS = 2000;
/** Finished jobs, abandoned uploads, and their raw files go after this long. */
const KEEP_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

let started = false;
let stopping = false;
let wake: (() => void) | null = null;
let current: Promise<void> | null = null;

/** Nudge an idle worker — a job was just queued. */
export function wakeWorker(): void {
  wake?.();
}

/**
 * Start the worker, once per process. Needs Postgres and R2; without either
 * it does nothing, and queued jobs simply wait for a process that has them.
 */
export function startWorker(): void {
  if (started || !process.env.DATABASE_URL || !getR2Client() || process.env.WORKER === 'off') return;
  started = true;
  console.log('[worker] started');
  void loop();
  void sweep();
  setInterval(() => void sweep(), SWEEP_EVERY_MS).unref();
}

/** Stop taking jobs. The one in hand is abandoned and retried by whichever process is next. */
export function stopWorker(): void {
  stopping = true;
  wake?.();
}

async function loop(): Promise<void> {
  while (!stopping) {
    try {
      await requeueStale();
      const job = await claim();
      if (job) {
        current = run(job);
        await current;
        current = null;
        continue;
      }
    } catch (err) {
      console.error('[worker] loop error:', err);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      wake = () => { clearTimeout(timer); resolve(); };
    });
    wake = null;
  }
}

/** The oldest queued job, now `running` and ours — or null. */
async function claim(): Promise<Job | null> {
  return db().transaction(async (tx) => {
    const [next] = await tx.select({ id: schema.job.id }).from(schema.job)
      .where(eq(schema.job.status, 'queued'))
      .orderBy(schema.job.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!next) return null;
    const now = new Date();
    const [job] = await tx.update(schema.job).set({
      status: 'running', attempts: sql`${schema.job.attempts} + 1`, progress: 0, error: null,
      lockedAt: now, updatedAt: now,
    }).where(eq(schema.job.id, next.id)).returning();
    return job;
  });
}

/** Running jobs nobody has touched lately go back to the queue — or fail, if out of tries. */
async function requeueStale(): Promise<void> {
  const stale = and(eq(schema.job.status, 'running'), lt(schema.job.lockedAt, new Date(Date.now() - STALE_MS)));
  const now = new Date();
  await db().update(schema.job)
    .set({ status: 'queued', lockedAt: null, updatedAt: now, error: 'Interrupted — trying again' })
    .where(and(stale, lt(schema.job.attempts, MAX_ATTEMPTS)));
  await db().update(schema.job)
    .set({ status: 'failed', lockedAt: null, updatedAt: now, finishedAt: now, error: 'Interrupted too many times' })
    .where(stale);
}

async function run(job: Job): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-job-'));
  try {
    const result = await transcodeStem(job, scratch);
    const now = new Date();
    await db().update(schema.job)
      .set({ status: 'done', progress: 1, result, error: null, lockedAt: null, updatedAt: now, finishedAt: now })
      .where(and(eq(schema.job.id, job.id), eq(schema.job.status, 'running')));
  } catch (err) {
    const message = String(errorMessage(err) ?? err).slice(0, 500);
    console.error(`[worker] job ${job.id} failed (attempt ${job.attempts}):`, message);
    const now = new Date();
    const last = job.attempts >= MAX_ATTEMPTS;
    await db().update(schema.job).set({
      status: last ? 'failed' : 'queued', error: message, lockedAt: null, updatedAt: now,
      ...(last ? { finishedAt: now } : {}),
    }).where(and(eq(schema.job.id, job.id), eq(schema.job.status, 'running')));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Raw upload → `<band>/songs/<song>/<stemId>.opus`. Progress: download 0–10%,
 * loudness 10–45%, transcode 45–95%, upload the rest.
 */
async function transcodeStem(job: Job, scratch: string): Promise<{ file: string }> {
  const p = job.payload as TranscodePayload;
  const [band] = await db().select({ legacyId: schema.band.legacyId }).from(schema.band)
    .where(eq(schema.band.id, job.bandId));
  if (!band?.legacyId) throw new Error('The band no longer exists');

  let lastWrite = 0;
  const report = (fraction: number, force = false) => {
    if (!force && Date.now() - lastWrite < PROGRESS_MS) return;
    lastWrite = Date.now();
    const now = new Date();
    db().update(schema.job).set({ progress: Math.min(0.99, fraction), lockedAt: now, updatedAt: now })
      .where(and(eq(schema.job.id, job.id), eq(schema.job.status, 'running')))
      .catch((err) => console.error('[worker] progress write failed:', err));
  };

  const raw = path.join(scratch, `raw${path.extname(p.filename).toLowerCase()}`);
  await r2DownloadToFile(p.rawKey, raw);
  report(0.1, true);

  const probe = await ffprobe(raw);
  let loudness: LoudnessInfo | undefined;
  if (p.normalize) {
    try {
      loudness = await measureLoudness(raw, probe.duration, (f) => report(0.1 + f * 0.35));
    } catch (err) {
      console.warn(`[worker] loudness measurement failed for ${p.filename}, transcoding without it:`, errorMessage(err));
    }
  }
  report(0.45, true);

  const file = `${p.stemId}.opus`;
  const out = path.join(scratch, file);
  await transcodeToOpus(raw, out, probe, loudness, p.normalize, (f) => report(0.45 + f * 0.5));
  report(0.95, true);

  await r2PutFile(`${band.legacyId}/songs/${p.songId}/${file}`, fs.readFileSync(out), 'audio/opus',
    'public, max-age=31536000, immutable');
  await r2DeleteKey(p.rawKey).catch(() => { /* the sweep gets it */ });
  return { file };
}

/**
 * Daily housekeeping: finished jobs and abandoned uploads older than a day
 * go, with their raw files; so does any raw file no job claims.
 */
async function sweep(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - KEEP_MS);
    const old = await db().delete(schema.job).where(and(
      lt(schema.job.updatedAt, cutoff),
      or(inArray(schema.job.status, ['done', 'failed', 'uploading'])),
    )).returning({ payload: schema.job.payload });
    for (const { payload } of old) {
      const key = (payload as Partial<TranscodePayload>).rawKey;
      if (key) await r2DeleteKey(key).catch(() => {});
    }
    const live = new Set((await db().select({ id: schema.job.id }).from(schema.job)).map((j) => j.id));
    let orphans = 0;
    for (const key of await r2ListKeys(INCOMING_PREFIX)) {
      const id = key.slice(INCOMING_PREFIX.length).split('/')[0];
      if (!live.has(id)) {
        await r2DeleteKey(key).catch(() => {});
        orphans++;
      }
    }
    if (old.length || orphans) console.log(`[worker] sweep: ${old.length} old job(s), ${orphans} orphaned upload(s)`);
  } catch (err) {
    console.error('[worker] sweep failed:', err);
  }
}

/** For tests and shutdown: the job in hand, if any, to await. */
export function currentJob(): Promise<void> | null {
  return current;
}
