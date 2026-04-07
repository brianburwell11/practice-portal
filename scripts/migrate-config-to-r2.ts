/**
 * Migration script: upload all config data to Cloudflare R2.
 *
 * Migrates bands.json, manifest.json, and per-song config.json files
 * from the local repo into R2, creating the new data structure:
 *
 *   registry.json                          — band list
 *   {bandId}/logo.{ext}                    — band logo
 *   {bandId}/songs/discography.json              — per-band song catalog
 *   {bandId}/songs/{songId}/config.json    — song config
 *
 * Usage:
 *   npx tsx scripts/migrate-config-to-r2.ts
 *   npx tsx scripts/migrate-config-to-r2.ts --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

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
const publicRoot = path.resolve('public');

interface BandConfig {
  id: string;
  name: string;
  route: string;
  colors: { primary: string; accent: string; background: string; text: string };
  logo?: string;
  songIds: string[];
}

interface ManifestEntry {
  id: string;
  title: string;
  artist: string;
  path: string;
  audioBasePath?: string;
}

async function uploadJson(key: string, data: unknown): Promise<void> {
  if (dryRun) {
    console.log(`  [would upload] ${key}`);
    return;
  }
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    CacheControl: 'no-cache',
  }));
  console.log(`  [uploaded] ${key}`);
}

async function uploadFile(key: string, filePath: string, contentType: string): Promise<void> {
  if (dryRun) {
    console.log(`  [would upload] ${key} (from ${filePath})`);
    return;
  }
  const body = fs.readFileSync(filePath);
  const sizeMB = (body.length / 1024 / 1024).toFixed(2);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400',
  }));
  console.log(`  [uploaded] ${key} (${sizeMB} MB)`);
}

async function verifyJson(key: string): Promise<boolean> {
  if (dryRun) return true;
  try {
    const result = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const body = await result.Body?.transformToString();
    if (!body) return false;
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

async function main() {
  if (dryRun) console.log('=== DRY RUN — no files will be uploaded ===\n');

  // Read local data
  const bandsPath = path.join(publicRoot, 'bands.json');
  const manifestPath = path.join(publicRoot, 'audio', 'manifest.json');

  const bandsData: { bands: BandConfig[] } = JSON.parse(fs.readFileSync(bandsPath, 'utf-8'));
  const manifestData: { songs: ManifestEntry[] } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  console.log(`Found ${bandsData.bands.length} bands, ${manifestData.songs.length} songs\n`);

  const registryBands: BandConfig[] = [];

  for (const band of bandsData.bands) {
    console.log(`\n--- Band: ${band.name} (${band.id}) ---`);

    // 1. Upload logo
    let logoR2Url: string | undefined;
    if (band.logo) {
      const localLogoPath = path.join(publicRoot, band.logo);
      if (fs.existsSync(localLogoPath)) {
        const ext = path.extname(band.logo);
        const logoKey = `${band.id}/logo${ext}`;
        await uploadFile(logoKey, localLogoPath, getContentType(ext));
        logoR2Url = `${R2_PUBLIC_URL}/${logoKey}`;
      } else {
        console.log(`  [warn] Logo not found: ${localLogoPath}`);
      }
    }

    // 2. Build per-band song index
    const bandSongs = manifestData.songs.filter((s) => band.songIds.includes(s.id));
    const songIndex = {
      songs: bandSongs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        audioBasePath: s.audioBasePath ?? `${R2_PUBLIC_URL}/${band.id}/song-${s.id}`,
      })),
    };

    console.log(`  ${bandSongs.length} songs in this band`);
    await uploadJson(`${band.id}/songs/discography.json`, songIndex);

    // 3. Upload each song config
    for (const song of bandSongs) {
      const localConfigPath = path.join(publicRoot, song.path, 'config.json');
      if (fs.existsSync(localConfigPath)) {
        const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf-8'));
        await uploadJson(`${band.id}/songs/${song.id}/config.json`, config);
      } else {
        console.log(`  [warn] Config not found: ${localConfigPath}`);
      }
    }

    // 4. Build registry entry
    registryBands.push({
      ...band,
      logo: logoR2Url,
    });
  }

  // 5. Upload registry.json
  console.log('\n--- Uploading registry.json ---');
  const registry = { bands: registryBands };
  await uploadJson('registry.json', registry);

  // 6. Verify uploads
  if (!dryRun) {
    console.log('\n--- Verifying uploads ---');
    let allGood = true;

    const ok = await verifyJson('registry.json');
    console.log(`  registry.json: ${ok ? 'OK' : 'FAILED'}`);
    if (!ok) allGood = false;

    for (const band of bandsData.bands) {
      const ok = await verifyJson(`${band.id}/songs/discography.json`);
      console.log(`  ${band.id}/songs/discography.json: ${ok ? 'OK' : 'FAILED'}`);
      if (!ok) allGood = false;

      const bandSongs = manifestData.songs.filter((s) => band.songIds.includes(s.id));
      for (const song of bandSongs) {
        const ok = await verifyJson(`${band.id}/songs/${song.id}/config.json`);
        console.log(`  ${band.id}/songs/${song.id}/config.json: ${ok ? 'OK' : 'FAILED'}`);
        if (!ok) allGood = false;
      }
    }

    if (allGood) {
      console.log('\nAll uploads verified successfully!');
    } else {
      console.error('\nSome uploads failed verification!');
      process.exit(1);
    }
  }

  console.log(dryRun
    ? '\n=== DRY RUN complete. Run without --dry-run to execute. ==='
    : '\nMigration complete!',
  );
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
