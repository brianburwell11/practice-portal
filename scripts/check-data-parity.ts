/**
 * Phase 4's exit check: every JSON document the SPA reads is the same whether
 * it comes from R2 or from `/api/data` (Postgres).
 *
 *   npx tsx scripts/check-data-parity.ts --url http://localhost:8080
 *   npx tsx scripts/check-data-parity.ts --url https://practice-portal.fly.dev
 *
 * Walks the R2 layout from registry.json down — bands, discographies, every
 * song's config/lyrics/notes, setlist indexes and setlists — and compares
 * each document, including that a missing file is missing on both sides.
 *
 * Discography is compared per song, not as an array: the API orders it by
 * import, R2 by insertion, and the UI sorts by title either way.
 *
 * Read-only on both sides; needs no credentials.
 */
import dotenv from 'dotenv';

dotenv.config();

const urlFlag = process.argv.indexOf('--url');
const api = urlFlag === -1 ? undefined : process.argv[urlFlag + 1]?.replace(/\/$/, '');
const r2 = (process.env.VITE_R2_PUBLIC_URL ?? process.env.R2_PUBLIC_URL)?.replace(/\/$/, '');
if (!api || !r2) {
  console.error('Usage: check-data-parity.ts --url <server> (R2 public URL comes from .env)');
  process.exit(2);
}

type Doc = { status: number; body: unknown };

async function fetchDoc(url: string): Promise<Doc> {
  const res = await fetch(url, { cache: 'no-store' });
  return { status: res.status, body: res.ok ? await res.json() : null };
}

/** JSON with object keys sorted — jsonb doesn't keep key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val);
}

let checked = 0;
const diffs: string[] = [];
const notes: string[] = [];

async function compare(key: string): Promise<Doc> {
  const [a, b] = await Promise.all([fetchDoc(`${r2}/${key}`), fetchDoc(`${api}/api/data/${key}`)]);
  checked++;
  // R2 answers a missing object with 403 or 404 depending on bucket config;
  // either way the SPA sees !ok.
  const aMissing = a.status === 404 || a.status === 403;
  if (aMissing && b.status === 404) return a;
  if (a.status !== 200 || b.status !== 200) {
    diffs.push(`${key}: R2 ${a.status}, API ${b.status}`);
  } else if (canonical(a.body) !== canonical(b.body)) {
    diffs.push(`${key}: content differs\n    R2:  ${canonical(a.body).slice(0, 200)}\n    API: ${canonical(b.body).slice(0, 200)}`);
  }
  return a;
}

async function compareDiscography(key: string): Promise<{ id: string }[]> {
  const [a, b] = await Promise.all([fetchDoc(`${r2}/${key}`), fetchDoc(`${api}/api/data/${key}`)]);
  checked++;
  if (a.status !== 200 || b.status !== 200) {
    diffs.push(`${key}: R2 ${a.status}, API ${b.status}`);
    return [];
  }
  const rs = (a.body as { songs: { id: string }[] }).songs;
  const as = new Map((b.body as { songs: { id: string }[] }).songs.map((s) => [s.id, s]));
  if (as.size !== rs.length) diffs.push(`${key}: ${rs.length} songs in R2, ${as.size} from API`);
  for (const s of rs) {
    const other = as.get(s.id);
    if (!other) { diffs.push(`${key}: ${s.id} missing from API`); continue; }
    if (canonical(s) === canonical(other)) continue;
    // Known: the discography can keep stray whitespace that the song's own
    // config doesn't, and the API derives entries from the config.
    const trim = (x: object) => canonical(JSON.parse(JSON.stringify(x), (_k, v) => typeof v === 'string' ? v.trim() : v));
    if (trim(s) === trim(other)) notes.push(`${key}: ${s.id} differs only in whitespace`);
    else diffs.push(`${key}: ${s.id} differs\n    R2:  ${canonical(s)}\n    API: ${canonical(other)}`);
  }
  return rs;
}

async function main(): Promise<void> {
  console.log(`R2:  ${r2}\nAPI: ${api}/api/data\n`);
  const registry = await compare('registry.json');
  for (const band of (registry.body as { bands: { id: string }[] }).bands) {
    await compare(`${band.id}/band.json`);
    const songs = await compareDiscography(`${band.id}/songs/discography.json`);
    for (const s of songs) {
      await Promise.all(['config', 'lyrics', 'notes'].map((f) => compare(`${band.id}/songs/${s.id}/${f}.json`)));
    }
    const index = await compare(`${band.id}/setlists/index.json`);
    for (const s of (index.body as { setlists: { id: string }[] } | null)?.setlists ?? []) {
      await compare(`${band.id}/setlists/${s.id}.json`);
    }
    console.log(`  ${band.id}: ${songs.length} songs checked`);
  }
  // A key that exists nowhere must 404 from the API, not 500 or {}.
  const missing = await fetchDoc(`${api}/api/data/no-such-band/band.json`);
  if (missing.status !== 404) diffs.push(`unknown band: API ${missing.status}, expected 404`);

  for (const n of notes) console.log(`note  ${n}`);
  for (const d of diffs) console.log(`DIFF  ${d}`);
  console.log(`\n${checked} documents compared, ${diffs.length} difference(s)`);
  process.exit(diffs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
