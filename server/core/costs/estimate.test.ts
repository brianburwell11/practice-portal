// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bandWeights, estimateCosts, monthProgress, type BandUsage, type Usage } from './estimate';
import { PRICING } from './pricing';
import { splitByUtcDay } from './uptime';

const band = (over: Partial<BandUsage> = {}): BandUsage => ({
  id: 'b', songs: 0, people: 1, storageBytes: 0, dbBytes: 0, emails: 0, transcodeSeconds: 0, ...over,
});

const usage = (over: Partial<Usage> = {}): Usage => ({
  // Halfway through November.
  now: new Date(Date.UTC(2026, 10, 16)),
  machineSeconds: 50 * 3600,
  dbBytes: 30e6,
  otherEmails: 0,
  bands: [],
  ...over,
});

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('monthProgress', () => {
  it('projects from the days so far', () => {
    expect(monthProgress(new Date(Date.UTC(2026, 10, 16)))).toEqual({ daysElapsed: 15, daysInMonth: 30, factor: 2 });
  });

  it('treats the first hours as a whole day', () => {
    expect(monthProgress(new Date(Date.UTC(2026, 10, 1, 1))).factor).toBe(30);
  });
});

describe('bandWeights', () => {
  it('averages the shares of songs, people and storage', () => {
    const w = bandWeights([
      { songs: 30, people: 1, storageBytes: 300 },
      { songs: 10, people: 3, storageBytes: 100 },
    ]);
    expect(w[0]).toBeCloseTo((0.75 + 0.25 + 0.75) / 3);
    expect(total(w)).toBeCloseTo(1);
  });

  it('skips a measure every band has none of', () => {
    const w = bandWeights([
      { songs: 0, people: 1, storageBytes: null },
      { songs: 0, people: 3, storageBytes: null },
    ]);
    expect(w).toEqual([0.25, 0.75]);
  });

  it('splits evenly when there is nothing to go on', () => {
    expect(bandWeights([{ songs: 0, people: 0, storageBytes: 0 }, { songs: 0, people: 0, storageBytes: 0 }])).toEqual([0.5, 0.5]);
    expect(bandWeights([])).toEqual([]);
  });
});

describe('estimateCosts', () => {
  it('projects machine time and bills it in full', () => {
    const fly = estimateCosts(usage()).services.find((s) => s.key === 'fly')!;
    expect(fly.usage).toBe(100);
    expect(fly.billedUsd).toBeCloseTo(100 * PRICING.fly.machineUsdPerHour);
  });

  it('bills nothing for usage inside the free tiers', () => {
    const e = estimateCosts(usage({ bands: [band({ storageBytes: 2e9, emails: 10 })] }));
    for (const key of ['r2', 'resend', 'neon_compute', 'neon_storage']) {
      const s = e.services.find((x) => x.key === key)!;
      expect(s.billedUsd).toBe(0);
      expect(s.listUsd).toBeGreaterThan(0);
    }
  });

  it('bills R2 only above its free storage', () => {
    const r2 = estimateCosts(usage({ bands: [band({ storageBytes: 14e9 })] })).services.find((s) => s.key === 'r2')!;
    expect(r2.billedUsd).toBeCloseTo(4 * PRICING.r2.usdPerGbMonth);
  });

  it('moves to Resend Pro past the free emails', () => {
    // 1,600 by mid-month projects to 3,200.
    const resend = estimateCosts(usage({ otherEmails: 1600 })).services.find((s) => s.key === 'resend')!;
    expect(resend.usage).toBe(3200);
    expect(resend.billedUsd).toBe(PRICING.resend.proUsdPerMonth);
  });

  it('band rows add up to the totals', () => {
    const e = estimateCosts(usage({
      otherEmails: 3,
      bands: [
        band({ id: 'a', songs: 40, people: 5, storageBytes: 3e9, dbBytes: 2e6, emails: 4, transcodeSeconds: 1800 }),
        band({ id: 'b', songs: 2, people: 1, storageBytes: 1e8, dbBytes: 1e5 }),
        band({ id: 'c' }),
      ],
    }));
    expect(total(e.bands.map((b) => b.listUsd))).toBeCloseTo(e.listUsd);
    expect(total(e.bands.map((b) => b.billedUsd))).toBeCloseTo(e.billedUsd);
    const a = e.bands.find((b) => b.bandId === 'a')!;
    expect(a.directListUsd).toBeGreaterThan(e.bands.find((b) => b.bandId === 'b')!.directListUsd);
  });

  it('never charges transcoding beyond the machine time', () => {
    const e = estimateCosts(usage({ machineSeconds: 600, bands: [band({ transcodeSeconds: 3600 })] }));
    const fly = e.services.find((s) => s.key === 'fly')!;
    expect(e.bands[0].directListUsd).toBeLessThanOrEqual(fly.listUsd + e.listUsd);
    expect(e.bands[0].listUsd).toBeCloseTo(e.listUsd);
  });

  it('copes with no uptime tracked yet', () => {
    const e = estimateCosts(usage({ machineSeconds: null, bands: [band()] }));
    expect(e.services.find((s) => s.key === 'fly')!.usage).toBe(0);
    expect(Number.isFinite(e.bands[0].billedUsd)).toBe(true);
  });
});

describe('splitByUtcDay', () => {
  it('cuts at midnight', () => {
    const from = Date.UTC(2026, 10, 4, 23, 30);
    const to = Date.UTC(2026, 10, 5, 0, 45);
    expect(splitByUtcDay(from, to)).toEqual([['2026-11-04', 1800], ['2026-11-05', 2700]]);
  });

  it('returns nothing for no time', () => {
    expect(splitByUtcDay(1000, 1000)).toEqual([]);
  });
});
