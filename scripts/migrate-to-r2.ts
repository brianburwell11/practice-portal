/**
 * Migration script: upload local audio stems to Cloudflare R2.
 *
 * For each song in manifest.json that has no `audioBasePath`, this script:
 *   1. Reads the song's config.json to find stem filenames
 *   2. Transcodes WAV/FLAC → MP3 CBR 256k (or 128k mono) via ffmpeg
 *   3. Uploads transcoded files to R2
 *   4. Updates config.json stem filenames to reference the .mp3 versions
 *   5. Updates manifest.json with the R2 audioBasePath
 *
 * Usage:
 *   npx tsx scripts/migrate-to-r2.ts
 *   npx tsx scripts/migrate-to-r2.ts --dry-run   # show what would happen
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

// --- R2 setup ---

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
const manifestPath = path.join(publicRoot, 'audio', 'manifest.json');

function resolveBandForSong(songId: string): string | null {
  const bandsPath = path.join(publicRoot, 'bands.json');
  const bands = JSON.parse(fs.readFileSync(bandsPath, 'utf-8')).bands;
  return bands.find((b: any) => b.songIds.includes(songId))?.id ?? null;
}

// --- ffmpeg helpers (mirrored from vite-plugin-config-api.ts) ---

interface ProbeResult {
  codec: string;
  bitrate: number;
  channels: number;
}

function ffprobe(filePath: string): ProbeResult {
  const raw = execSync(
    `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
    { encoding: 'utf-8' },
  );
  const data = JSON.parse(raw);
  const audio = data.streams?.find((s: any) => s.codec_type === 'audio');
  if (!audio) throw new Error(`No audio stream in ${filePath}`);
  return {
    codec: audio.codec_name ?? '',
    bitrate: parseInt(audio.bit_rate ?? '0', 10),
    channels: audio.channels ?? 0,
  };
}

function shouldSkipTranscode(probe: ProbeResult): boolean {
  return probe.codec === 'mp3' && probe.bitrate >= 256000;
}

function transcodeToMp3(inputPath: string, outputPath: string, probe: ProbeResult): void {
  const isMono = probe.channels === 1;
  const bitrate = isMono ? '128k' : '256k';
  const channelFlag = isMono ? '-ac 1' : '';
  execSync(
    `ffmpeg -y -i "${inputPath}" -codec:a libmp3lame -b:a ${bitrate} ${channelFlag} -ar 44100 "${outputPath}"`,
    { stdio: 'ignore' },
  );
}

// --- Main ---

interface ManifestEntry {
  id: string;
  title: string;
  artist: string;
  path: string;
  audioBasePath?: string;
}

interface StemConfig {
  id: string;
  label: string;
  file: string;
  [key: string]: unknown;
}

async function migrateSong(entry: ManifestEntry): Promise<{ fileMap: Record<string, string> }> {
  const songDir = path.join(publicRoot, entry.path);
  const configPath = path.join(songDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    console.log(`  [skip] no config.json found at ${configPath}`);
    return { fileMap: {} };
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const stems: StemConfig[] = config.stems ?? [];
  const fileMap: Record<string, string> = {};
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `r2-migrate-${entry.id}-`));

  console.log(`  ${stems.length} stems to process`);

  for (const stem of stems) {
    const inputPath = path.join(songDir, stem.file);
    if (!fs.existsSync(inputPath)) {
      console.log(`  [skip] ${stem.file} — file not found`);
      continue;
    }

    const probe = ffprobe(inputPath);
    let uploadPath: string;
    let uploadName: string;

    if (shouldSkipTranscode(probe)) {
      uploadPath = inputPath;
      uploadName = stem.file;
      console.log(`  [keep]  ${stem.file} (already MP3 ≥256k)`);
    } else {
      uploadName = stem.file.replace(/\.[^.]+$/, '.mp3');
      uploadPath = path.join(tmpDir, uploadName);
      console.log(`  [transcode] ${stem.file} → ${uploadName} (${probe.codec}, ${probe.channels}ch)`);
      if (!dryRun) {
        transcodeToMp3(inputPath, uploadPath, probe);
      }
    }

    fileMap[stem.file] = uploadName;

    if (!dryRun) {
      const bandId = resolveBandForSong(entry.id);
      const prefix = bandId ? `${bandId}/song-${entry.id}` : `song-${entry.id}`;
      const key = `${prefix}/${uploadName}`;
      const body = fs.readFileSync(uploadPath);
      const sizeMB = (body.length / 1024 / 1024).toFixed(1);
      console.log(`  [upload] ${key} (${sizeMB} MB)`);
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'audio/mpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    }
  }

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { fileMap };
}

async function main() {
  if (dryRun) console.log('=== DRY RUN — no files will be uploaded or modified ===\n');

  const manifest: { songs: ManifestEntry[] } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const toMigrate = manifest.songs.filter((s) => !s.audioBasePath);

  if (toMigrate.length === 0) {
    console.log('All songs already have audioBasePath. Nothing to migrate.');
    return;
  }

  console.log(`Found ${toMigrate.length} songs to migrate:\n`);

  for (const entry of toMigrate) {
    console.log(`\n--- ${entry.title} (${entry.id}) ---`);

    const { fileMap } = await migrateSong(entry);

    // Update config.json stem filenames
    const configPath = path.join(publicRoot, entry.path, 'config.json');
    if (fs.existsSync(configPath) && Object.keys(fileMap).length > 0) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      let changed = false;
      for (const stem of config.stems) {
        if (fileMap[stem.file] && fileMap[stem.file] !== stem.file) {
          stem.file = fileMap[stem.file];
          changed = true;
        }
      }
      if (changed && !dryRun) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        console.log(`  [update] config.json — stem filenames updated`);
      } else if (changed) {
        console.log(`  [would update] config.json — stem filenames`);
      }
    }

    // Update manifest entry with audioBasePath
    const bandId = resolveBandForSong(entry.id);
    const prefix = bandId ? `${bandId}/song-${entry.id}` : `song-${entry.id}`;
    entry.audioBasePath = `${R2_PUBLIC_URL}/${prefix}`;
    if (!dryRun) {
      console.log(`  [update] manifest.json — audioBasePath = ${entry.audioBasePath}`);
    } else {
      console.log(`  [would set] audioBasePath = ${entry.audioBasePath}`);
    }
  }

  // Write updated manifest
  if (!dryRun) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log('\nManifest updated. Migration complete.');
  } else {
    console.log('\n=== DRY RUN complete. Run without --dry-run to execute. ===');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
