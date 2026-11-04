// @vitest-environment node
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheForTests, clearCache, memo } from '../core/cache';
import { createApiHandler } from './nodeApi';

/** A bare request through the real API handler (no database: DATABASE_URL unset). */
async function send(method: string, url: string): Promise<number> {
  const req = Object.assign(Readable.from([]), {
    method,
    url,
    headers: { host: 'localhost', origin: 'http://localhost' },
    socket: {},
  }) as unknown as IncomingMessage;
  let status = 0;
  const headers: Record<string, unknown> = {};
  const res = {
    set statusCode(v: number) { status = v; },
    get statusCode() { return status; },
    setHeader(name: string, value: unknown) { headers[name] = value; },
    end() {},
  } as unknown as ServerResponse;
  await createApiHandler()(req, res);
  return status;
}

let savedUrl: string | undefined;
beforeEach(async () => {
  savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  clearCache();
  await memo('doc:someone:band.json', async () => ({ cached: true }));
});
afterEach(() => {
  if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
  clearCache();
});

describe('the API clears the read cache on writes', () => {
  it('after a write request, even one that is refused', async () => {
    expect(cacheForTests.size()).toBe(1);
    const status = await send('POST', '/api/bands/b/songs/s/config');
    expect(status).toBe(401);
    expect(cacheForTests.size()).toBe(0);
  });

  it('not after a read', async () => {
    await send('GET', '/api/bands/b/members');
    expect(cacheForTests.size()).toBe(1);
  });
});
