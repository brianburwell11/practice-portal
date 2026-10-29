/**
 * Phase 9's stem pipeline, end to end: raw files straight to object storage,
 * the queue, the worker's transcode and progress, failures and retries, a job
 * orphaned by a restart, and band isolation.
 *
 * Runs against a scratch Postgres and MinIO (an S3 stand-in), never R2:
 *
 *   docker run -d --rm --name pp-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=pp -p 55432:5432 postgres:17
 *   docker run -d --rm --name pp-minio -p 9000:9000 minio/minio server /data
 *   export DATABASE_URL=postgres://postgres:test@localhost:55432/pp R2_ENDPOINT=http://localhost:9000 \
 *     R2_ACCESS_KEY_ID=minioadmin R2_SECRET_ACCESS_KEY=minioadmin R2_BUCKET=pp-test R2_FORCE_PATH_STYLE=1
 *   npx drizzle-kit migrate && npm run build:server
 *   PORT=18558 node --env-file=.env dist-server/server.js &
 *   npx tsx scripts/verify-jobs.ts --url http://localhost:18558
 *
 * Refuses to run unless R2_ENDPOINT points at localhost.
 */
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { getR2Client, r2DownloadToFile, r2HeadSize } from '../server/core/r2';

dotenv.config({ quiet: true });

const urlFlag = process.argv.indexOf('--url');
const base = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
if (!base || !process.env.DATABASE_URL || !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(process.env.R2_ENDPOINT ?? '')) {
  console.error('Usage: verify-jobs.ts --url <server>   (DATABASE_URL, and R2_* pointing at a local MinIO — see the header)');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const TAG = `vj-${randomBytes(3).toString('hex')}`;
const BAND = `${TAG}-band`;
const OTHER = `${TAG}-other`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-jobs-'));

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}

interface User { id: string; cookie: string }

async function makeUser(name: string): Promise<User> {
  const [u] = await sql`insert into app_user (email, display_name) values (${`${TAG}-${name}@example.invalid`}, ${name}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into session (token_hash, user_id, expires_at)
            values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, now() + interval '30 minutes')`;
  return { id: u.id as string, cookie: `pp_session=${token}` };
}

async function call(user: User | null, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      ...(user ? { cookie: user.cookie } : {}),
      ...(method !== 'GET' ? { origin: base!, 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json };
}

function tone(name: string, seconds: number, freq: number): string {
  const file = path.join(scratch, name);
  const r = spawnSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}:sample_rate=48000`,
    '-ac', '2', '-c:a', 'pcm_s24le', file]);
  if (r.status !== 0) throw new Error('ffmpeg could not make a test stem');
  return file;
}

interface JobView { id: string; stemId: string; status: string; progress: number; error: string | null; file: string | null }

/** Poll until every job is done or failed; also collects every progress value seen. */
async function settle(user: User, songPath: string, ids: string[], timeoutMs = 120_000) {
  const seen: number[] = [];
  const until = Date.now() + timeoutMs;
  let jobs: JobView[] = [];
  while (Date.now() < until) {
    jobs = (await call(user, 'GET', `${songPath}/stems?jobs=${ids.join(',')}`)).json.jobs as JobView[];
    for (const j of jobs) if (j.status === 'running') seen.push(j.progress);
    if (jobs.every((j) => j.status === 'done' || j.status === 'failed')) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return { jobs, seen };
}

async function upload(url: string, file: string): Promise<number> {
  return (await fetch(url, { method: 'PUT', body: fs.readFileSync(file) })).status;
}

async function main(): Promise<void> {
  await getR2Client()!.send(new CreateBucketCommand({ Bucket: process.env.R2_BUCKET })).catch(() => { /* exists */ });
  const users: User[] = [];
  try {
    const owner = await makeUser('owner');
    const editor = await makeUser('editor');
    const member = await makeUser('member');
    const otherOwner = await makeUser('other-owner');
    users.push(owner, editor, member, otherOwner);
    const colors = '{"primary":"#000","accent":"#111","background":"#000","text":"#fff"}';
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id) values (${BAND}, ${BAND}, ${BAND}, ${colors}, ${owner.id})`;
    await sql`insert into band (slug, legacy_id, name, colors, owner_user_id) values (${OTHER}, ${OTHER}, ${OTHER}, ${colors}, ${otherOwner.id})`;
    for (const [u, role] of [[editor, 'editor'], [member, 'member']] as const) {
      await sql`insert into membership (user_id, band_id, role) select ${u.id}, id, ${role} from band where legacy_id = ${BAND}`;
    }
    const song = `/api/bands/${BAND}/songs/s1`;
    const bass = tone('bass.wav', 30, 110);
    const keys = tone('keys.wav', 30, 440);
    const files = [
      { stemId: 'bass', filename: 'Bass DI (final).wav', size: fs.statSync(bass).size },
      { stemId: 'keys', filename: 'keys.wav', size: fs.statSync(keys).size },
    ];

    console.log('--- who may upload, and what');
    check('signed out → 401', (await call(null, 'POST', `${song}/stems`, { files })).status === 401);
    check('a member → 403', (await call(member, 'POST', `${song}/stems`, { files })).status === 403);
    check('another band’s owner → 403', (await call(otherOwner, 'POST', `${song}/stems`, { files })).status === 403);
    check('no files → 400', (await call(editor, 'POST', `${song}/stems`, { files: [] })).status === 400);
    check('not audio → 400', (await call(editor, 'POST', `${song}/stems`, { files: [{ stemId: 'x', filename: 'notes.pdf', size: 10 }] })).status === 400);
    check('over 1 GB → 400', (await call(editor, 'POST', `${song}/stems`, { files: [{ stemId: 'x', filename: 'a.wav', size: 2 * 1024 ** 3 }] })).status === 400);
    check('a stem id with a slash → 400', (await call(editor, 'POST', `${song}/stems`, { files: [{ stemId: '../x', filename: 'a.wav', size: 10 }] })).status === 400);
    check('two stems, one id → 400', (await call(editor, 'POST', `${song}/stems`, { files: [files[0], { ...files[1], stemId: 'bass' }] })).status === 400);

    console.log('\n--- upload, queue, transcode');
    const created = await call(editor, 'POST', `${song}/stems`, { files });
    const jobs = (created.json.jobs ?? []) as { id: string; stemId: string; uploadUrl: string }[];
    check('an editor gets two jobs with upload links', created.status === 200 && jobs.length === 2 && jobs.every((j) => j.uploadUrl.startsWith('http')), JSON.stringify(created.json));
    const ids = jobs.map((j) => j.id);
    check('…uploading', ((await call(editor, 'GET', `${song}/stems?jobs=${ids}`)).json.jobs as JobView[]).every((j) => j.status === 'uploading'));
    const [{ raw_key: rawKey }] = await sql`select payload->>'rawKey' raw_key from job where id = ${ids[0]}`;
    check('the raw key keeps only the extension', /^_incoming\/[0-9a-f-]{36}\/raw\.wav$/.test(rawKey), rawKey);
    check('queueing before uploading → 400', (await call(editor, 'POST', `${song}/stems/queue`, { jobIds: ids })).status === 400);
    const puts = await Promise.all(jobs.map((j) => upload(j.uploadUrl, j.stemId === 'bass' ? bass : keys)));
    check('the browser-style PUTs to storage succeed', puts.every((st) => st === 200), puts.join(', '));
    const queued = await call(editor, 'POST', `${song}/stems/queue`, { jobIds: ids });
    check('queueing them', queued.status === 200 && queued.json.queued === 2, JSON.stringify(queued.json));
    const { jobs: done, seen } = await settle(editor, song, ids);
    check('both stems finish', done.every((j) => j.status === 'done'), JSON.stringify(done));
    check('progress was reported along the way', seen.some((p) => p > 0 && p < 1), `saw ${seen.length} running polls: ${seen.slice(0, 8).join(', ')}`);
    check('…named <stemId>.opus', done.every((j) => j.file === `${j.stemId}.opus`));
    for (const stem of ['bass', 'keys']) {
      const out = path.join(scratch, `${stem}.opus`);
      await r2DownloadToFile(`${BAND}/songs/s1/${stem}.opus`, out);
      const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', out], { encoding: 'utf-8' });
      const info = JSON.parse(probe.stdout || '{}');
      check(`${stem}.opus is Opus and ~30 s long`, info.streams?.[0]?.codec_name === 'opus' && Math.abs(Number(info.format?.duration) - 30) < 0.5, probe.stdout);
    }
    check('the raw uploads are deleted', (await r2HeadSize(rawKey)) === null);
    check('queueing again is harmless', (await call(editor, 'POST', `${song}/stems/queue`, { jobIds: ids })).json.queued === 0);

    console.log('\n--- isolation');
    check('another band’s owner can’t read the jobs', (await call(otherOwner, 'GET', `${song}/stems?jobs=${ids}`)).status === 403);
    check('…nor through their own band’s path', ((await call(otherOwner, 'GET', `/api/bands/${OTHER}/songs/s1/stems?jobs=${ids}`)).json.jobs as unknown[]).length === 0);
    check('another song’s path sees none of them', ((await call(editor, 'GET', `/api/bands/${BAND}/songs/s2/stems?jobs=${ids}`)).json.jobs as unknown[]).length === 0);
    check('…and can’t queue them', (await call(editor, 'POST', `/api/bands/${BAND}/songs/s2/stems/queue`, { jobIds: ids })).status === 404);

    console.log('\n--- a file that won’t transcode');
    const junk = path.join(scratch, 'junk.wav');
    fs.writeFileSync(junk, randomBytes(4096));
    const bad = ((await call(editor, 'POST', `${song}/stems`, { files: [{ stemId: 'junk', filename: 'junk.wav', size: 4096 }] })).json.jobs as { id: string; uploadUrl: string }[])[0];
    await upload(bad.uploadUrl, junk);
    await call(editor, 'POST', `${song}/stems/queue`, { jobIds: [bad.id] });
    const failed = (await settle(editor, song, [bad.id])).jobs[0];
    const [{ attempts }] = await sql`select attempts from job where id = ${bad.id}`;
    check('fails after 3 attempts, with a reason', failed?.status === 'failed' && attempts === 3 && !!failed.error, JSON.stringify({ ...failed, attempts }));
    check('retrying a done job → 409', (await call(editor, 'POST', `${song}/stems/${ids[0]}/retry`)).status === 409);
    check('a member can’t retry → 403', (await call(member, 'POST', `${song}/stems/${bad.id}/retry`)).status === 403);
    check('retry puts it back in the queue', (await call(editor, 'POST', `${song}/stems/${bad.id}/retry`)).status === 200);
    const again = (await settle(editor, song, [bad.id])).jobs[0];
    check('…and it fails again, honestly', again?.status === 'failed');

    console.log('\n--- a job orphaned by a restart');
    const orphan = ((await call(editor, 'POST', `${song}/stems`, { files: [{ stemId: 'pad', filename: 'pad.wav', size: fs.statSync(keys).size }] })).json.jobs as { id: string; uploadUrl: string }[])[0];
    await upload(orphan.uploadUrl, keys);
    // As if a worker claimed it and then the machine went away.
    await sql`update job set status = 'running', attempts = 1, locked_at = now() - interval '10 minutes' where id = ${orphan.id}`;
    const recovered = (await settle(editor, song, [orphan.id], 60_000)).jobs[0];
    check('a stale running job is picked up again and finishes', recovered?.status === 'done' && recovered.file === 'pad.opus', JSON.stringify(recovered));

    const audit = await sql`select action from audit_log a join band b on b.id = a.band_id where b.legacy_id = ${BAND}`;
    check('uploads are audited', audit.some((r) => r.action === 'song.audio.upload'), audit.map((r) => r.action).join(', '));
  } finally {
    const ids = users.map((u) => u.id);
    await sql`delete from audit_log where band_id in (select id from band where legacy_id like ${TAG + '%'}) or actor_id = any(${ids})`;
    await sql`delete from band where legacy_id like ${TAG + '%'}`;
    await sql`delete from app_user where id = any(${ids})`;
    await sql.end();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
