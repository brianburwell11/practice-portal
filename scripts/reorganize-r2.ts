/**
 * Reorganize R2 bucket: move objects from flat song-{id}/ prefixes
 * to band-nested {band-id}/song-{id}/ prefixes.
 *
 * Also deletes orphan objects (song-test-tones/).
 *
 * Usage:
 *   npx tsx scripts/reorganize-r2.ts --dry-run   # preview changes
 *   npx tsx scripts/reorganize-r2.ts              # execute
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

dotenv.config();

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
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

// Build songId → bandId map from bands.json
const bandsPath = path.resolve('public', 'bands.json');
const bands: { id: string; songIds: string[] }[] = JSON.parse(
  fs.readFileSync(bandsPath, 'utf-8'),
).bands;

const songToBand = new Map<string, string>();
for (const band of bands) {
  for (const songId of band.songIds) {
    songToBand.set(songId, band.id);
  }
}

// Songs that had audioBasePath in the old manifest (flat keys in R2)
const songIds = [
  'test-tones',
  'wiggle-sooza',
  'gunk-palace-sooza',
  'bella-ciao-sooza',
  '22-sooza',
  'foo-bar',
  'dev-dev',
];

const orphans = ['test-tones'];

async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

async function main() {
  if (dryRun) console.log('=== DRY RUN — no objects will be moved or deleted ===\n');

  let copied = 0;
  let deleted = 0;

  for (const songId of songIds) {
    const oldPrefix = `song-${songId}/`;
    const keys = await listObjects(oldPrefix);

    if (keys.length === 0) {
      console.log(`[skip] ${oldPrefix} — no objects found`);
      continue;
    }

    const isOrphan = orphans.includes(songId);
    const bandId = songToBand.get(songId);

    if (isOrphan) {
      console.log(`\n[delete orphan] ${oldPrefix} (${keys.length} objects)`);
      for (const key of keys) {
        console.log(`  DELETE ${key}`);
        if (!dryRun) {
          await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        }
        deleted++;
      }
      continue;
    }

    if (!bandId) {
      console.log(`[skip] ${oldPrefix} — no band mapping found`);
      continue;
    }

    const newPrefix = `${bandId}/song-${songId}/`;
    console.log(`\n[move] ${oldPrefix} → ${newPrefix} (${keys.length} objects)`);

    for (const key of keys) {
      const filename = key.slice(oldPrefix.length);
      const newKey = `${newPrefix}${filename}`;

      console.log(`  COPY  ${key} → ${newKey}`);
      if (!dryRun) {
        await r2.send(
          new CopyObjectCommand({
            Bucket: R2_BUCKET,
            CopySource: `${R2_BUCKET}/${key}`,
            Key: newKey,
          }),
        );
      }
      copied++;
    }

    // Delete old keys after all copies succeed
    for (const key of keys) {
      console.log(`  DELETE ${key}`);
      if (!dryRun) {
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      }
      deleted++;
    }
  }

  console.log(`\n${dryRun ? 'Would copy' : 'Copied'}: ${copied} objects`);
  console.log(`${dryRun ? 'Would delete' : 'Deleted'}: ${deleted} objects`);

  if (dryRun) {
    console.log('\n=== DRY RUN complete. Run without --dry-run to execute. ===');
  } else {
    console.log('\nR2 reorganization complete.');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
