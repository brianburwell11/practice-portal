import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocConflictError, fetchDoc, forgetRev, knownRev, saveDoc } from './docRevs';

vi.stubEnv('VITE_DATA_SOURCE', 'api');

const KEY = 'band/songs/s1/lyrics.json';
const URL_ = '/api/bands/band/songs/s1/lyrics';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  forgetRev(KEY);
});

describe('fetchDoc', () => {
  it('records the revision header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(200, { lines: [] }, { 'X-Doc-Rev': '7' }));
    await fetchDoc(KEY);
    expect(knownRev(KEY)).toBe(7);
  });

  it('treats a missing lyrics file from the server as revision 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(404, { error: 'Not found' }));
    await fetchDoc(KEY);
    expect(knownRev(KEY)).toBe(0);
  });

  it('ignores documents without revisions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(200, {}, { 'X-Doc-Rev': '3' }));
    await fetchDoc('band/setlists/index.json');
    expect(knownRev('band/setlists/index.json')).toBeUndefined();
  });
});

describe('saveDoc', () => {
  it('sends no baseRev when none is known, and records the new one', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(200, { ok: true, rev: 2 }));
    await saveDoc(KEY, URL_, { lines: [] });
    expect(spy.mock.calls[0][0]).toBe(URL_);
    expect(knownRev(KEY)).toBe(2);
  });

  it('sends the known revision, then bases the next save on the new one', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(200, { lines: [] }, { 'X-Doc-Rev': '4' }))
      .mockResolvedValueOnce(respond(200, { ok: true, rev: 5 }))
      .mockResolvedValueOnce(respond(200, { ok: true, rev: 6 }));
    await fetchDoc(KEY);
    await saveDoc(KEY, URL_, { lines: [] });
    await saveDoc(KEY, URL_, { lines: [] });
    expect(spy.mock.calls[1][0]).toBe(`${URL_}?baseRev=4`);
    expect(spy.mock.calls[2][0]).toBe(`${URL_}?baseRev=5`);
  });

  it('throws DocConflictError with the current copy on a 409', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(respond(200, {}, { 'X-Doc-Rev': '1' }))
      .mockResolvedValueOnce(respond(409, { error: 'changed', current: { lines: [{ text: 'theirs' }] }, rev: 3 }));
    await fetchDoc(KEY);
    const err = await saveDoc(KEY, URL_, { lines: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(DocConflictError);
    expect(err.rev).toBe(3);
    expect(err.current).toEqual({ lines: [{ text: 'theirs' }] });
    expect(knownRev(KEY)).toBe(1);
  });

  it('throws the server message on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(respond(403, { error: 'Not allowed' }));
    await expect(saveDoc(KEY, URL_, {})).rejects.toThrow('Not allowed');
  });
});
