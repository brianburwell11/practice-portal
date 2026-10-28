/**
 * Phase 8c: does a real multi-stem transcode survive the hosted server?
 * Times one Add Song upload (the wizard's single multipart POST to
 * transcode-upload) and, alongside it, how long /healthz takes to answer —
 * ffmpeg runs synchronously, so a slow /healthz means every other request
 * on the machine waited too.
 *
 *   npx tsx scripts/measure-transcode.ts --url https://practiceportal.app
 *   npx tsx scripts/measure-transcode.ts --url ... --stems 8 --seconds 300
 *   npx tsx scripts/measure-transcode.ts --url ... path/to/a.wav path/to/b.wav
 *
 * Without file arguments it synthesizes `--stems` stereo 48 kHz/24-bit WAVs
 * of `--seconds` each (default 6 × 240 s, ~66 MB apiece) with local ffmpeg.
 * Needs DATABASE_URL and R2 credentials in .env. Creates a throwaway user and
 * Members-only band, and deletes them and their R2 objects in `finally`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { r2DeleteKey, r2ListKeys } from '../server/core/r2';

dotenv.config({ quiet: true });

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const base = flag('url')?.replace(/\/$/, '');
const stemCount = Number(flag('stems') ?? 6);
const seconds = Number(flag('seconds') ?? 240);
const normalize = !process.argv.includes('--no-normalize');
const given = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!base || !process.env.DATABASE_URL) {
  console.error('Usage: measure-transcode.ts --url <server> [--stems N] [--seconds S] [--no-normalize] [files…]');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `mt-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const SONG = 'transcode-test';

function synthesize(dir: string): string[] {
  const files: string[] = [];
  for (let i = 0; i < stemCount; i++) {
    const file = path.join(dir, `stem${i + 1}.wav`);
    // A tone plus quiet noise: something loudnorm has to measure, and
    // that doesn't compress to nothing the way silence would.
    const r = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `sine=frequency=${110 * (i + 1)}:sample_rate=48000:duration=${seconds}`,
      '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=${seconds}`,
      '-filter_complex', '[0][1]amix=inputs=2,pan=stereo|c0=c0|c1=c0',
      '-c:a', 'pcm_s24le', file,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
    files.push(file);
  }
  return files;
}

async function main(): Promise<void> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-transcode-'));
  let userId: string | undefined;
  try {
    const files = given.length ? given : synthesize(scratch);
    const totalBytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
    console.log(`${files.length} stem(s), ${(totalBytes / 1e6).toFixed(0)} MB, normalize=${normalize}`);

    const [u] = await sql`insert into app_user (email, display_name) values (${`${TAG}@example.invalid`}, ${TAG}) returning id`;
    userId = u.id as string;
    const token = randomBytes(32).toString('base64url');
    await sql`insert into session (token_hash, user_id, expires_at)
              values (${createHash('sha256').update(token).digest('hex')}, ${userId}, now() + interval '1 hour')`;
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id, visibility)
              values (${BAND}, ${BAND}, ${BAND}, ${colors}, ${userId}, 'private')`;

    const form = new FormData();
    files.forEach((f, i) => {
      form.append('stems', new Blob([fs.readFileSync(f)]), `stem${i + 1}${path.extname(f)}`);
    });

    // Poll /healthz throughout; record the slowest answer.
    let polling = true;
    const health: number[] = [];
    const poller = (async () => {
      while (polling) {
        const t = performance.now();
        try { await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(120_000) }); } catch { /* counted as slow */ }
        health.push(performance.now() - t);
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();

    const started = performance.now();
    const res = await fetch(`${base}/api/r2/transcode-upload/${BAND}/${SONG}${normalize ? '' : '?normalize=0'}`, {
      method: 'POST',
      headers: { cookie: `pp_session=${token}`, origin: base! },
      body: form,
      signal: AbortSignal.timeout(30 * 60_000),
    });
    const body = await res.text();
    const elapsed = (performance.now() - started) / 1000;
    polling = false;
    await poller;

    console.log(`status ${res.status} after ${elapsed.toFixed(1)} s`);
    console.log(body.slice(0, 300));
    const opus = (await r2ListKeys(`${BAND}/songs/${SONG}/`)).filter((k) => k.endsWith('.opus'));
    console.log(`${opus.length}/${files.length} .opus objects on R2`);
    const sorted = [...health].sort((a, b) => a - b);
    console.log(`/healthz during the run: ${health.length} polls, median ${sorted[sorted.length >> 1]?.toFixed(0)} ms, worst ${sorted.at(-1)?.toFixed(0)} ms`);
    process.exitCode = res.ok && opus.length === files.length ? 0 : 1;
  } finally {
    for (const key of await r2ListKeys(`${BAND}/`)) await r2DeleteKey(key);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id = ${BAND})`;
    await sql`delete from band where legacy_id = ${BAND}`;
    if (userId) {
      await sql`delete from audit_log where actor_id = ${userId}`;
      await sql`delete from app_user where id = ${userId}`;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(`cleanup: ${(await r2ListKeys(`${BAND}/`)).length} R2 object(s) left`);
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
