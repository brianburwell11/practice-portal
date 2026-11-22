// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { r2PresignGet } from './r2';

// Signing is local (no request goes out), so made-up credentials do.
const ENV = {
  R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const HOUR = 60 * 60 * 1000;
const WINDOW_START = Date.UTC(2026, 10, 22, 12);
const KEY = 'band/songs/song/score.mxl';

/** When a presigned URL stops working. */
function expiresAt(url: string): number {
  const q = new URL(url).searchParams;
  const d = q.get('X-Amz-Date')!; // 20261122T120000Z
  const signed = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));
  return signed + Number(q.get('X-Amz-Expires')) * 1000;
}

describe('r2PresignGet', () => {
  it('gives a file the same URL all through its 6-hour window', async () => {
    const a = await r2PresignGet(KEY, WINDOW_START + 1000, 'v1');
    const b = await r2PresignGet(KEY, WINDOW_START + 6 * HOUR - 1000, 'v1');
    expect(a).toBe(b);
  });

  it('gives a new version of a file a new URL in the same window', async () => {
    // A score saved again under the same name: the old URL is in the
    // browser's cache as immutable, so the new version must not reuse it.
    const before = await r2PresignGet(KEY, WINDOW_START + HOUR, 'oldetag');
    const after = await r2PresignGet(KEY, WINDOW_START + HOUR, 'newetag');
    expect(after).not.toBe(before);
  });

  it('keeps every URL working well past the end of its window', async () => {
    for (const version of [undefined, 'v1', 'v2', 'abc123', 'zzz']) {
      const url = await r2PresignGet(KEY, WINDOW_START, version);
      // The redirect to it is reused for an hour after the window's last request.
      expect(expiresAt(url)).toBeGreaterThanOrEqual(WINDOW_START + 6 * HOUR + HOUR);
    }
  });
});
