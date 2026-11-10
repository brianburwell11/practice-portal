/**
 * Save a song's chords through the real `song.chords.write` route: Postgres,
 * the audit log and the R2 copy, exactly as the app's save would. A stand-in
 * for the Chords Editor until Phase 2 builds it.
 *
 *   npx tsx scripts/set-chords.ts --band dev --song QBIBTcj --file chords.json
 *   npx tsx scripts/set-chords.ts --band dev --song QBIBTcj --per-bar "Bb Gm F Eb"
 *   npx tsx scripts/set-chords.ts --band dev --song QBIBTcj --clear
 *
 *   --file      a `{ "chords": [{ "symbol": "G", "time": 1.2 }, ...] }` file
 *   --per-bar   test data: these chords in turn, one per tapMap measure
 *   --clear     save an empty chord list
 *   --dry-run   print what would be saved and stop
 *
 * Uses DATABASE_URL and the R2 settings from .env. Point it at a scratch
 * database for anything but deliberate changes: Neon is shared with prod.
 */
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { chordsDataSchema, songConfigSchema } from '../src/config/schema';
import { readDocumentUnchecked } from '../server/core/documents';
import { db } from '../server/db/client';
import { routes } from '../server/core/routes';
import { inRequestTransaction } from '../server/core/store';
import type { Db } from '../server/core/documents';
import type { CoreRequest } from '../server/core/types';

dotenv.config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const band = arg('band');
  const song = arg('song');
  if (!band || !song) throw new Error('--band and --song are required');

  const configDoc = await readDocumentUnchecked(`${band}/songs/${song}/config.json`, db() as unknown as Db);
  if (!configDoc) throw new Error(`No song ${band}/songs/${song}`);
  const config = songConfigSchema.parse(configDoc);
  console.log(`${config.title} — ${config.artist} (key ${config.key}, ${config.tapMap?.length ?? 0} taps)`);

  let body: unknown;
  if (flag('clear')) {
    body = { chords: [] };
  } else if (arg('file')) {
    body = JSON.parse(readFileSync(arg('file')!, 'utf8'));
  } else if (arg('per-bar')) {
    const symbols = arg('per-bar')!.split(/\s+/).filter(Boolean);
    const bars = (config.tapMap ?? []).filter((e) => e.type !== 'beat').map((e) => e.time).sort((a, b) => a - b);
    if (bars.length === 0) throw new Error('This song has no tapMap measures; use --file');
    body = { chords: bars.map((time, i) => ({ symbol: symbols[i % symbols.length], time })) };
  } else {
    throw new Error('Pass --file, --per-bar or --clear');
  }

  const data = chordsDataSchema.parse(body);
  console.log(`${data.chords.length} chords, first: ${data.chords.slice(0, 6).map((c) => `${c.symbol}@${c.time.toFixed(2)}`).join(' ')}`);
  if (flag('dry-run')) return;

  const route = routes.find((r) => r.name === 'song.chords.write');
  if (!route) throw new Error('song.chords.write route not found');
  const params = { bandId: band, songId: song };
  const req = { params, query: new URLSearchParams(), cookies: {}, origin: 'script', body: data } as CoreRequest;
  await inRequestTransaction(route, params, undefined, () => route.handler(req));

  const saved = await readDocumentUnchecked(`${band}/songs/${song}/chords.json`, db() as unknown as Db) as { chords: unknown[] } | null;
  console.log(`Saved. ${band}/songs/${song}/chords.json now has ${saved?.chords.length ?? 0} chords.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
