/**
 * Counts how long this server process runs, per UTC day, into
 * `machine_uptime`: Fly bills per second while a machine runs, and with
 * auto-stop nobody otherwise knows how long that is.
 *
 * Only on Fly (`FLY_MACHINE_ID` is set), or with UPTIME_TRACKING=1 for
 * testing: local dev may point at the shared database, and shouldn't count.
 *
 * Seconds are kept in memory and written:
 * - at shutdown (`flushUptime`, from server/main.ts's signal handler), and
 * - at most every `FLUSH_EVERY_MS`, after an API request (`maybeFlushUptime`).
 *   A request means the database is already awake, so this never wakes Neon
 *   on its own. A crash loses what wasn't written yet.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';

const FLUSH_EVERY_MS = 15 * 60_000;

let machineId: string | null = null;
/** Running time up to here has been written. */
let flushedTo = 0;
let flushing: Promise<void> | null = null;

export function startUptime(now = Date.now()): void {
  const id = process.env.FLY_MACHINE_ID || (process.env.UPTIME_TRACKING === '1' ? 'local' : '');
  if (!id || !process.env.DATABASE_URL) return;
  machineId = id;
  flushedTo = now;
}

/** `[from, to)` cut at each UTC midnight, as `[day, seconds]`. */
export function splitByUtcDay(from: number, to: number): [string, number][] {
  const out: [string, number][] = [];
  let start = from;
  while (start < to) {
    const d = new Date(start);
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const end = Math.min(to, nextMidnight);
    const seconds = Math.round((end - start) / 1000);
    if (seconds > 0) out.push([d.toISOString().slice(0, 10), seconds]);
    start = end;
  }
  return out;
}

export function flushUptime(now = Date.now()): Promise<void> {
  if (!machineId) return Promise.resolve();
  if (flushing) return flushing;
  const from = flushedTo;
  const rows = splitByUtcDay(from, now);
  if (rows.length === 0) return Promise.resolve();
  const id = machineId;
  flushing = db().insert(schema.machineUptime)
    .values(rows.map(([day, seconds]) => ({ day, machineId: id, seconds })))
    .onConflictDoUpdate({
      target: [schema.machineUptime.day, schema.machineUptime.machineId],
      set: { seconds: sql`${schema.machineUptime.seconds} + excluded.seconds` },
    })
    .then(() => { flushedTo = now; })
    // Not migrated yet, or the database is down: keep counting, try later.
    .catch((err) => console.error('[uptime] write failed:', err))
    .finally(() => { flushing = null; });
  return flushing;
}

/** After an API request: write if it's been a while. Never waits. */
export function maybeFlushUptime(now = Date.now()): void {
  if (machineId && now - flushedTo >= FLUSH_EVERY_MS) void flushUptime(now);
}
