/**
 * Postgres connection for the API server.
 *
 * postgres.js over plain TCP works for both candidate hosts (Fly Postgres and
 * Neon). If Neon + edge runtime ever becomes the target, `@neondatabase/serverless`
 * is a drop-in swap at this boundary and nowhere else.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const sql = postgres(url, {
    // Fly's shared-CPU machines are small; a modest pool avoids exhausting
    // Postgres connections when several containers run at once.
    max: 10,
    idle_timeout: 30,
  });
  return drizzle(sql, { schema });
}

let cached: Db | undefined;

/** Process-wide connection, created on first use from `DATABASE_URL`. */
export function db(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    cached = createDb(url);
  }
  return cached;
}
