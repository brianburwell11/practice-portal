/**
 * Rewrite R2's `registry.json` from Postgres, the source of truth since
 * Phase 6b. Use it when the R2 copy has drifted — e.g. it lists a band that
 * no longer exists in Postgres.
 *
 *   npx tsx scripts/sync-r2-registry.ts --dry-run   # show what would change
 *   npx tsx scripts/sync-r2-registry.ts             # write it
 *
 * Needs DATABASE_URL and R2 credentials (.env). Touches only registry.json.
 */
import dotenv from 'dotenv';
import { readDocumentUnchecked, type Db } from '../server/core/documents';
import { isNoSuchKey, r2ReadJson, r2WriteJson } from '../server/core/r2';
import { db } from '../server/db/client';

dotenv.config();

export async function syncRegistry(dryRun: boolean): Promise<{ removed: string[]; added: string[] }> {
  const fresh = await readDocumentUnchecked('registry.json', db() as unknown as Db) as { bands: { id: string }[] };
  let current: { bands: { id: string }[] } = { bands: [] };
  try {
    current = await r2ReadJson('registry.json');
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
  }
  const want = fresh.bands.map((b) => b.id);
  const have = current.bands.map((b) => b.id);
  const removed = have.filter((id) => !want.includes(id));
  const added = want.filter((id) => !have.includes(id));
  if (!dryRun && JSON.stringify(current) !== JSON.stringify(fresh)) await r2WriteJson('registry.json', fresh);
  return { removed, added };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  syncRegistry(dryRun).then(({ removed, added }) => {
    console.log(`${dryRun ? 'Would remove' : 'Removed'}: ${removed.join(', ') || '(none)'}`);
    console.log(`${dryRun ? 'Would add' : 'Added'}:   ${added.join(', ') || '(none)'}`);
    process.exit(0);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
