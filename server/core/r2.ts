/**
 * R2 (S3-compatible) access for the API core.
 *
 * Credentials are read from `process.env` lazily, per call, so whichever
 * adapter is hosting the core decides how env gets loaded (dotenv in the
 * Vite plugin, Fly secrets on the server) without this module caring.
 */
import {
  S3Client,
  PutObjectCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from './http';

export function getR2Client(): S3Client | null {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

/** Public base URL for R2 objects. May be undefined when R2 isn't configured. */
export function r2PublicUrl(): string | undefined {
  return process.env.R2_PUBLIC_URL;
}

function requireR2(): { r2: S3Client; bucket: string } {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new Error('R2 not configured');
  return { r2, bucket };
}

/**
 * Same check as `requireR2`, but surfaced as an explicit 500 with the
 * operator-facing hint. Used by the upload/presign routes, which report
 * missing credentials rather than treating them as a bad request.
 */
export function assertR2Configured(): { r2: S3Client; bucket: string } {
  const r2 = getR2Client();
  const bucket = process.env.R2_BUCKET;
  if (!r2 || !bucket) throw new HttpError(500, 'R2 not configured — check .env');
  return { r2, bucket };
}

// --- Postgres mirror ---

/**
 * Receives every successful JSON write, delete and copy, so Postgres can stay
 * in step while R2 is still where the admin writes (Phase 4). Registered by
 * the host — the Vite plugin, when `DATABASE_URL` is set — so this module
 * never imports the database.
 */
export interface JsonMirror {
  write(key: string, data: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

let mirror: JsonMirror | undefined;

export function setJsonMirror(m: JsonMirror | undefined): void {
  mirror = m;
}

/**
 * Run a mirror step. A failure is logged as well as thrown: several handlers
 * wrap R2 deletes in a bare `catch {}`, and a swallowed mirror error would
 * leave Postgres silently stale.
 */
async function mirrored(what: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (err) {
    console.error(`[r2 → postgres] ${what} succeeded in R2 but failed to mirror:`, err);
    throw err;
  }
}

// --- JSON read/write helpers ---

/**
 * Read and parse a JSON object. `T` is asserted, not validated — callers that
 * need guarantees run the record through its Zod schema.
 */
export async function r2ReadJson<T>(key: string): Promise<T> {
  const { r2, bucket } = requireR2();
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await result.Body?.transformToString();
  if (!body) throw new Error(`Empty body for R2 key: ${key}`);
  return JSON.parse(body) as T;
}

export async function r2WriteJson(key: string, data: unknown, cacheControl = 'no-cache'): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    CacheControl: cacheControl,
  }));
  if (mirror) await mirrored(`write ${key}`, () => mirror!.write(key, data));
}

export async function r2DeleteKey(key: string): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  if (mirror && key.endsWith('.json')) await mirrored(`delete ${key}`, () => mirror!.delete(key));
}

export async function r2PutFile(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
  }));
}

export async function r2CopyKey(fromKey: string, toKey: string): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${fromKey}`,
    Key: toKey,
  }));
  // Mirror the copy's contents as R2 now holds them: a song rename deletes the
  // old config (and so its Postgres row) before it copies the lyrics across.
  if (mirror && toKey.endsWith('.json')) {
    await mirrored(`copy ${fromKey} → ${toKey}`, async () => mirror!.write(toKey, await r2ReadJson(toKey)));
  }
}

export async function r2ListKeys(prefix: string): Promise<string[]> {
  const { r2, bucket } = requireR2();
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

export async function r2StorageBytes(prefix: string): Promise<{ totalBytes: number; objectCount: number }> {
  const { r2, bucket } = requireR2();
  let totalBytes = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const obj of list.Contents ?? []) {
      totalBytes += obj.Size ?? 0;
      objectCount += 1;
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);
  return { totalBytes, objectCount };
}

/** Presigned PUT URL for a direct-from-browser upload. */
export async function r2PresignPut(key: string, expiresIn = 3600): Promise<string> {
  const { r2, bucket } = assertR2Configured();
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** True when the error means "object doesn't exist" rather than "call failed". */
export function isNoSuchKey(err: unknown): boolean {
  const e = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  } | null | undefined;
  return e?.name === 'NoSuchKey'
    || e?.Code === 'NoSuchKey'
    || e?.$metadata?.httpStatusCode === 404;
}
