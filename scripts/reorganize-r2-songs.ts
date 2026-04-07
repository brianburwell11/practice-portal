/**
 * Reorganize R2: move audio stems from {bandId}/song-{songId}/ to {bandId}/songs/{songId}/
 * so that audio stems and config.json are co-located under the same prefix.
 *
 * Also updates audioBasePath in each band's discography.json.
 *
 * Usage:
 *   npx tsx scripts/reorganize-r2-songs.ts
 *   npx tsx scripts/reorganize-r2-songs.ts --dry-run
 */

import dotenv from 'dotenv';
import { S3Client, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
  console.error('Missing R2 environment variables. Check .env file.');
  process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const dryRun = process.argv.includes('--dry-run');

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
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

async function readJson(key: string): Promise<any> {
  const result = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const body = await result.Body?.transformToString();
  if (!body) throw new Error(`Empty body for key: ${key}`);
  return JSON.parse(body);
}

async function writeJson(key: string, data: unknown): Promise<void> {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-cache',
  }));
}

async function main() {
  if (dryRun) console.log('=== DRY RUN ===\n');

  // Read registry to get all bands
  const registry = await readJson('registry.json');
  console.log(`Found ${registry.bands.length} bands\n`);

  for (const band of registry.bands) {
    console.log(`--- ${band.name} (${band.id}) ---`);

    // Find all old-style audio keys: {bandId}/song-{songId}/*
    const oldKeys = await listKeys(`${band.id}/song-`);
    if (oldKeys.length === 0) {
      console.log('  No old-style audio keys found\n');
      continue;
    }

    console.log(`  ${oldKeys.length} objects to move`);

    // Group by song
    const songGroups = new Map<string, string[]>();
    for (const key of oldKeys) {
      // key: bandId/song-{songId}/{filename}
      const match = key.match(new RegExp(`^${band.id}/song-([^/]+)/(.+)$`));
      if (match) {
        const songId = match[1];
        if (!songGroups.has(songId)) songGroups.set(songId, []);
        songGroups.get(songId)!.push(key);
      }
    }

    for (const [songId, keys] of songGroups) {
      const oldPrefix = `${band.id}/song-${songId}/`;
      const newPrefix = `${band.id}/songs/${songId}/`;

      for (const key of keys) {
        const filename = key.slice(oldPrefix.length);
        // Skip config.json — it already exists at songs/{songId}/config.json
        if (filename === 'config.json') continue;

        const newKey = `${newPrefix}${filename}`;

        if (dryRun) {
          console.log(`  [would copy] ${key} → ${newKey}`);
        } else {
          await r2.send(new CopyObjectCommand({
            Bucket: R2_BUCKET,
            CopySource: `${R2_BUCKET}/${key}`,
            Key: newKey,
          }));
          console.log(`  [copied] ${key} → ${newKey}`);
        }
      }

      // Delete old keys
      for (const key of keys) {
        if (dryRun) {
          console.log(`  [would delete] ${key}`);
        } else {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
          console.log(`  [deleted] ${key}`);
        }
      }
    }

    // Update discography.json audioBasePath values
    try {
      const discography = await readJson(`${band.id}/songs/discography.json`);
      let updated = false;
      for (const song of discography.songs) {
        if (song.audioBasePath) {
          const oldPath = `${R2_PUBLIC_URL}/${band.id}/song-${song.id}`;
          const newPath = `${R2_PUBLIC_URL}/${band.id}/songs/${song.id}`;
          if (song.audioBasePath === oldPath) {
            song.audioBasePath = newPath;
            updated = true;
          }
        }
      }
      if (updated) {
        if (dryRun) {
          console.log(`  [would update] ${band.id}/songs/discography.json audioBasePaths`);
        } else {
          await writeJson(`${band.id}/songs/discography.json`, discography);
          console.log(`  [updated] ${band.id}/songs/discography.json`);
        }
      }
    } catch {
      console.log(`  [skip] No discography.json for ${band.id}`);
    }

    console.log();
  }

  console.log(dryRun ? '=== DRY RUN complete ===' : 'Reorganization complete!');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
