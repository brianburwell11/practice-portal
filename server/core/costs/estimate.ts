/**
 * The monthly cost estimate on /admin: what this month should cost, by
 * service and by band.
 *
 * Usage so far this month (machine time, emails, transcodes) is projected to
 * the whole month; storage is a level and isn't. A band is charged directly
 * for what it alone causes (its storage, its emails, its transcodes) plus a
 * share of everything else (the machine sitting there, the database's
 * compute, the domain), weighted by how big it is. Band rows add up to the
 * total, in list price and in the estimated bill.
 *
 * Not counted: R2 operations, Fly bandwidth and stopped-machine storage. At
 * our size they're cents.
 */
import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { PRICING } from './pricing';

export interface BandUsage {
  id: string;
  songs: number;
  people: number;
  /** R2 bytes, or null when they couldn't be measured. */
  storageBytes: number | null;
  /** Database bytes of its songs and setlists. */
  dbBytes: number;
  /** Emails sent for it so far this month. */
  emails: number;
  /** Seconds of transcoding so far this month. */
  transcodeSeconds: number;
}

export interface Usage {
  now: Date;
  /** Seconds the machine ran so far this month, or null if not tracked yet. */
  machineSeconds: number | null;
  /** The whole database's size. */
  dbBytes: number;
  /** Emails not sent for any band (site admin emails). */
  otherEmails: number;
  bands: BandUsage[];
}

export interface ServiceCost {
  key: 'fly' | 'neon_compute' | 'neon_storage' | 'r2' | 'resend' | 'domain';
  label: string;
  /** Projected usage for the month, in `unit`. */
  usage: number;
  unit: string;
  /** The free allowance in `unit`, if the plan has one. */
  freeLimit: number | null;
  listUsd: number;
  billedUsd: number;
}

export interface BandCost {
  bandId: string;
  /** Share of the shared costs, 0 to 1. */
  weight: number;
  directListUsd: number;
  sharedListUsd: number;
  listUsd: number;
  billedUsd: number;
}

export interface CostEstimate {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  /** Seconds the machine ran so far this month; null before tracking started. */
  machineSeconds: number | null;
  services: ServiceCost[];
  listUsd: number;
  billedUsd: number;
  bands: BandCost[];
}

const GB = 1e9;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * How far into the (UTC) month `now` is. Projection never multiplies by more
 * than the days in the month: an hour in, it treats it as a whole day.
 */
export function monthProgress(now: Date): { daysElapsed: number; daysInMonth: number; factor: number } {
  const start = monthStart(now);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = Math.min(daysInMonth, Math.max(1, (now.getTime() - start.getTime()) / 864e5));
  return { daysElapsed, daysInMonth, factor: daysInMonth / daysElapsed };
}

/**
 * Each band's share of the shared costs: the average of its shares of songs,
 * people and storage (a measure everyone has zero of is skipped). If no band
 * has any of them, they share evenly.
 */
export function bandWeights(bands: Pick<BandUsage, 'songs' | 'people' | 'storageBytes'>[]): number[] {
  if (bands.length === 0) return [];
  const measures = [
    bands.map((b) => b.songs),
    bands.map((b) => b.people),
    bands.map((b) => b.storageBytes ?? 0),
  ].filter((m) => sum(m) > 0);
  if (measures.length === 0) return bands.map(() => 1 / bands.length);
  return bands.map((_, i) => sum(measures.map((m) => m[i] / sum(m))) / measures.length);
}

export function estimateCosts(u: Usage): CostEstimate {
  const { daysElapsed, daysInMonth, factor } = monthProgress(u.now);
  const p = PRICING;

  const machineHours = ((u.machineSeconds ?? 0) * factor) / 3600;
  const cuHours = machineHours * p.neon.cu;
  const dbGb = u.dbBytes / GB;
  const r2Gb = sum(u.bands.map((b) => b.storageBytes ?? 0)) / GB;
  const emails = (sum(u.bands.map((b) => b.emails)) + u.otherEmails) * factor;
  const neonFree = p.neon.plan === 'free';

  const services: ServiceCost[] = [
    {
      key: 'fly', label: 'Fly.io machine', usage: machineHours, unit: 'hours', freeLimit: null,
      listUsd: machineHours * p.fly.machineUsdPerHour, billedUsd: machineHours * p.fly.machineUsdPerHour,
    },
    {
      key: 'neon_compute', label: 'Neon compute', usage: cuHours, unit: 'CU-hours',
      freeLimit: neonFree ? p.neon.freeCuHours : null,
      listUsd: cuHours * p.neon.usdPerCuHour, billedUsd: neonFree ? 0 : cuHours * p.neon.usdPerCuHour,
    },
    {
      key: 'neon_storage', label: 'Neon storage', usage: dbGb, unit: 'GB',
      freeLimit: neonFree ? p.neon.freeStorageGb : null,
      listUsd: dbGb * p.neon.usdPerGbMonth, billedUsd: neonFree ? 0 : dbGb * p.neon.usdPerGbMonth,
    },
    {
      key: 'r2', label: 'Cloudflare R2 storage', usage: r2Gb, unit: 'GB', freeLimit: p.r2.freeGb,
      listUsd: r2Gb * p.r2.usdPerGbMonth, billedUsd: Math.max(0, r2Gb - p.r2.freeGb) * p.r2.usdPerGbMonth,
    },
    {
      key: 'resend', label: 'Resend email', usage: emails, unit: 'emails', freeLimit: p.resend.freeEmails,
      listUsd: emails * p.resend.listUsdPerEmail, billedUsd: emails > p.resend.freeEmails ? p.resend.proUsdPerMonth : 0,
    },
  ];
  if (p.domainUsdPerMonth > 0) {
    services.push({
      key: 'domain', label: 'Domain', usage: 1, unit: 'domain', freeLimit: null,
      listUsd: p.domainUsdPerMonth, billedUsd: p.domainUsdPerMonth,
    });
  }
  const listUsd = sum(services.map((s) => s.listUsd));
  const billedUsd = sum(services.map((s) => s.billedUsd));

  // What each band causes on its own, at list price. Transcoding is part of
  // the machine's time, so it can't come to more than that.
  const transcodeHours = u.bands.map((b) => (b.transcodeSeconds * factor) / 3600);
  const transcodeScale = Math.min(1, machineHours / Math.max(sum(transcodeHours), 1e-9));
  const direct = u.bands.map((b, i) =>
    ((b.storageBytes ?? 0) / GB) * p.r2.usdPerGbMonth
    + (b.dbBytes / GB) * p.neon.usdPerGbMonth
    + b.emails * factor * p.resend.listUsdPerEmail
    + transcodeHours[i] * transcodeScale * p.fly.machineUsdPerHour);
  const shared = Math.max(0, listUsd - sum(direct));
  const weights = bandWeights(u.bands);
  // List price to the estimated bill: the free tiers, spread evenly.
  const billedRatio = listUsd > 0 ? billedUsd / listUsd : 0;

  return {
    month: u.now.toISOString().slice(0, 7),
    daysElapsed,
    daysInMonth,
    machineSeconds: u.machineSeconds,
    services,
    listUsd,
    billedUsd,
    bands: u.bands.map((b, i) => {
      const bandList = direct[i] + shared * weights[i];
      return {
        bandId: b.id,
        weight: weights[i],
        directListUsd: direct[i],
        sharedListUsd: shared * weights[i],
        listUsd: bandList,
        billedUsd: bandList * billedRatio,
      };
    }),
  };
}

/** `[bandId, n]` rows as a map. */
const byBand = (rows: { bandId: string | null; n: number | string | null }[]) =>
  new Map(rows.filter((r) => r.bandId).map((r) => [r.bandId!, Number(r.n ?? 0)]));

/**
 * This month's usage from the database. `bands` brings what the bands
 * dashboard already counted (songs, people, R2 storage).
 */
export async function loadUsage(
  bands: Pick<BandUsage, 'id' | 'songs' | 'people' | 'storageBytes'>[],
  now = new Date(),
): Promise<Usage> {
  const since = monthStart(now);
  const d = db();

  const machineSeconds = d.select({ s: sql<string | null>`sum(${schema.machineUptime.seconds})` })
    .from(schema.machineUptime)
    .where(gte(schema.machineUptime.day, since.toISOString().slice(0, 10)))
    .then(([r]) => (r?.s == null ? null : Number(r.s)))
    // Not migrated yet.
    .catch(() => null);

  const [seconds, [{ size }], songBytes, setlistBytes, invites, asked, decided, [{ admin }], transcodes] = await Promise.all([
    machineSeconds,
    // postgres.js answers with the rows, PGlite (tests) with `{ rows }`.
    d.execute(sql`select pg_database_size(current_database())::text as size`)
      .then((r) => ((r as { rows?: unknown }).rows ?? r) as { size: string }[]),
    d.select({ bandId: schema.song.bandId, n: sql<string>`sum(pg_column_size(${schema.song}.*))` })
      .from(schema.song).where(isNull(schema.song.deletedAt)).groupBy(schema.song.bandId),
    d.select({ bandId: schema.setlist.bandId, n: sql<string>`sum(pg_column_size(${schema.setlist}.*))` })
      .from(schema.setlist).where(isNull(schema.setlist.deletedAt)).groupBy(schema.setlist.bandId),
    d.select({ bandId: schema.invite.bandId, n: count() }).from(schema.invite)
      .where(gte(schema.invite.emailedAt, since)).groupBy(schema.invite.bandId),
    // A request emails the Owner; a decision emails the person who asked.
    d.select({ bandId: schema.accessRequest.bandId, n: count() }).from(schema.accessRequest)
      .where(gte(schema.accessRequest.createdAt, since)).groupBy(schema.accessRequest.bandId),
    d.select({ bandId: schema.accessRequest.bandId, n: count() }).from(schema.accessRequest)
      .where(gte(schema.accessRequest.decidedAt, since)).groupBy(schema.accessRequest.bandId),
    d.select({ admin: count() }).from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'admin.email_user'), gte(schema.auditLog.at, since))),
    d.select({
      bandId: schema.job.bandId,
      n: sql<string>`sum(extract(epoch from ${schema.job.finishedAt} - ${schema.job.startedAt}))`,
    }).from(schema.job)
      .where(and(gte(schema.job.finishedAt, since), isNotNull(schema.job.startedAt)))
      .groupBy(schema.job.bandId)
      // Not migrated yet.
      .catch(() => []),
  ]);

  const maps = {
    songs: byBand(songBytes), setlists: byBand(setlistBytes),
    invites: byBand(invites), asked: byBand(asked), decided: byBand(decided), transcodes: byBand(transcodes),
  };
  return {
    now,
    machineSeconds: seconds,
    dbBytes: Number(size),
    otherEmails: admin,
    bands: bands.map((b) => ({
      ...b,
      dbBytes: (maps.songs.get(b.id) ?? 0) + (maps.setlists.get(b.id) ?? 0),
      emails: (maps.invites.get(b.id) ?? 0) + (maps.asked.get(b.id) ?? 0) + (maps.decided.get(b.id) ?? 0),
      transcodeSeconds: maps.transcodes.get(b.id) ?? 0,
    })),
  };
}
