// @vitest-environment node
/**
 * `loadUsage` and the uptime writer against a migrated in-process Postgres
 * (PGlite): this month's emails, transcodes and machine time land on the
 * right band, and last month's don't count.
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';

const pg = await PGlite.create({ extensions: { citext } });
const testDb = drizzle(pg, { schema });
vi.mock('../../db/client', () => ({ db: () => testDb }));

const { estimateCosts, loadUsage } = await import('./estimate');
const { flushUptime, startUptime } = await import('./uptime');

const NOW = new Date(Date.UTC(2026, 10, 16, 12));
const LAST_MONTH = new Date(Date.UTC(2026, 9, 20));
const THIS_MONTH = new Date(Date.UTC(2026, 10, 10));

let bandA = '';
let bandB = '';

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: './server/db/migrations' });
  const [owner] = await testDb.insert(schema.appUser).values({ email: 'owner@example.com' }).returning();
  const [asker] = await testDb.insert(schema.appUser).values({ email: 'asker@example.com' }).returning();
  const bands = await testDb.insert(schema.band).values([
    { slug: 'cost-a', name: 'A', colors: {} as never, ownerUserId: owner.id },
    { slug: 'cost-b', name: 'B', colors: {} as never, ownerUserId: owner.id },
  ]).returning();
  [bandA, bandB] = bands.map((b) => b.id);

  await testDb.insert(schema.song).values({
    bandId: bandA, slug: 's', title: 'Song', artist: 'X', config: { tapMap: Array(500).fill(1.5) },
  });
  const invite = { role: 'member', createdBy: owner.id, expiresAt: NOW };
  await testDb.insert(schema.invite).values([
    { ...invite, bandId: bandA, tokenHash: '1', emailedAt: THIS_MONTH },
    { ...invite, bandId: bandA, tokenHash: '2', emailedAt: THIS_MONTH },
    { ...invite, bandId: bandA, tokenHash: '3', emailedAt: LAST_MONTH },
    { ...invite, bandId: bandB, tokenHash: '4' },
  ]);
  await testDb.insert(schema.accessRequest).values({
    bandId: bandB, userId: asker.id, status: 'approved', createdAt: THIS_MONTH, decidedAt: THIS_MONTH,
  });
  const job = { kind: 'transcode_stem', payload: {}, status: 'done' };
  await testDb.insert(schema.job).values([
    { ...job, bandId: bandA, startedAt: new Date(THIS_MONTH.getTime() - 120_000), finishedAt: THIS_MONTH },
    { ...job, bandId: bandA, startedAt: new Date(LAST_MONTH.getTime() - 999_000), finishedAt: LAST_MONTH },
  ]);
  await testDb.insert(schema.auditLog).values({ actorKind: 'support', action: 'admin.email_user', at: THIS_MONTH });
  await testDb.insert(schema.machineUptime).values({ day: '2026-10-31', machineId: 'm', seconds: 99_999 });
});

describe('machine uptime', () => {
  it('adds up across flushes and days', async () => {
    process.env.UPTIME_TRACKING = '1';
    process.env.DATABASE_URL ??= 'pglite';
    const start = Date.UTC(2026, 10, 14, 23);
    startUptime(start);
    await flushUptime(start + 30 * 60_000);
    await flushUptime(start + 2 * 3600_000);
    const rows = await testDb.select().from(schema.machineUptime).orderBy(schema.machineUptime.day);
    expect(rows.filter((r) => r.machineId === 'local').map((r) => [r.day, r.seconds]))
      .toEqual([['2026-11-14', 3600], ['2026-11-15', 3600]]);
  });
});

describe('loadUsage', () => {
  it('counts this month, by band', async () => {
    const u = await loadUsage([
      { id: bandA, songs: 1, people: 1, storageBytes: 5e8 },
      { id: bandB, songs: 0, people: 2, storageBytes: null },
    ], NOW);
    expect(u.machineSeconds).toBe(7200);
    expect(u.otherEmails).toBe(1);
    expect(u.dbBytes).toBeGreaterThan(0);
    const [a, b] = u.bands;
    expect(a.emails).toBe(2);
    expect(a.transcodeSeconds).toBe(120);
    expect(a.dbBytes).toBeGreaterThan(0);
    expect(b.emails).toBe(2);
    expect(b.transcodeSeconds).toBe(0);
    expect(b.dbBytes).toBe(0);

    const e = estimateCosts(u);
    const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
    expect(sum(e.bands.map((x) => x.listUsd))).toBeCloseTo(e.listUsd);
    expect(sum(e.bands.map((x) => x.billedUsd))).toBeCloseTo(e.billedUsd);
  });
});
