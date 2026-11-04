// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheForTests, clearCache, memo, TTL_MS, viewerKey } from './cache';

let t = 0;
beforeEach(() => { clearCache(); t = 1_000_000; cacheForTests.setClock(() => t); });
afterEach(() => { clearCache(); cacheForTests.resetClock(); });

describe('memo', () => {
  it('loads once and serves the cached value until it expires', async () => {
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await memo('k', load)).toEqual({ n: 1 });
    t += TTL_MS - 1;
    expect(await memo('k', load)).toEqual({ n: 1 });
    t += 2;
    expect(await memo('k', load)).toEqual({ n: 2 });
  });

  it('shares one lookup between concurrent requests', async () => {
    let loads = 0;
    let release!: (v: number) => void;
    const load = () => { loads++; return new Promise<number>((r) => { release = r; }); };
    const a = memo('k', load);
    const b = memo('k', load);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(loads).toBe(1);
  });

  it("doesn't keep a failed lookup", async () => {
    await expect(memo('k', () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
    expect(await memo('k', async () => 'ok')).toBe('ok');
  });

  it('caches null and undefined answers (a 404, an unknown session)', async () => {
    let loads = 0;
    expect(await memo('k', async () => { loads++; return null; })).toBeNull();
    expect(await memo('k', async () => { loads++; return null; })).toBeNull();
    expect(loads).toBe(1);
  });

  it('forgets everything on clearCache (any write)', async () => {
    let loads = 0;
    await memo('k', async () => ++loads);
    clearCache();
    expect(await memo('k', async () => ++loads)).toBe(2);
  });

  it("gives each caller its own copy, so one can't change the next one's", async () => {
    const first = await memo('k', async () => ({ songs: ['a'] }));
    first.songs.push('changed');
    expect(await memo('k', async () => ({ songs: [] as string[] }))).toEqual({ songs: ['a'] });
  });

  it('drops the least recently used past its size cap', async () => {
    for (let i = 0; i < 1005; i++) await memo(`k${i}`, async () => i);
    expect(cacheForTests.size()).toBe(1000);
    let reloaded = false;
    await memo('k0', async () => { reloaded = true; return 0; });
    expect(reloaded).toBe(true);
  });
});

describe('viewerKey', () => {
  it('tells viewers apart, and ignores guest link order', () => {
    expect(viewerKey({})).not.toBe(viewerKey({ userId: 'u1' }));
    expect(viewerKey({ userId: 'u1' })).not.toBe(viewerKey({ userId: 'u1', siteAdmin: true }));
    expect(viewerKey({ guestBandIds: ['b', 'a'] })).toBe(viewerKey({ guestBandIds: ['a', 'b'] }));
    expect(viewerKey({ guestBandIds: ['a'] })).not.toBe(viewerKey({}));
  });
});
