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
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from './http';

export function getR2Client(): S3Client | null {
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    // An S3 stand-in for tests wants bucket-in-path addressing.
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === '1',
    // Otherwise the SDK signs a CRC32 of the *empty* body into every presigned
    // PUT (x-amz-checksum-crc32=AAAAAA==). R2 ignores it today; stores that
    // check it reject the real upload as a bad digest.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
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
}

export async function r2DeleteKey(key: string): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function r2PutFile(
  key: string,
  body: Buffer,
  contentType: string,
  cacheControl: string,
  contentDisposition?: string,
): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: cacheControl,
    ContentDisposition: contentDisposition,
  }));
}

export async function r2CopyKey(fromKey: string, toKey: string): Promise<void> {
  const { r2, bucket } = requireR2();
  await r2.send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${fromKey}`,
    Key: toKey,
  }));
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

/**
 * Presigned PUT URL for a direct-from-browser upload. The size and type are
 * signed in, so the upload must send exactly `contentLength` bytes with
 * exactly `contentType`: nobody can reuse the URL for a bigger file or one
 * served as something else (an HTML page under a `.xml` name).
 */
export async function r2PresignPut(
  key: string,
  { contentType, contentLength, expiresIn = 3600 }: { contentType: string; contentLength: number; expiresIn?: number },
): Promise<string> {
  const { r2, bucket } = assertR2Configured();
  return getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
    // The presigner leaves Content-Type unsigned unless asked.
    { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  );
}

/** An object's size in bytes, or null if there's no such object. */
export async function r2HeadSize(key: string): Promise<number | null> {
  const { r2, bucket } = requireR2();
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

/** Stream an object to a local file — raw stems can be hundreds of megabytes. */
export async function r2DownloadToFile(key: string, filePath: string): Promise<void> {
  const { r2, bucket } = requireR2();
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Empty body for R2 key: ${key}`);
  await pipeline(result.Body as Readable, fs.createWriteStream(filePath));
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
