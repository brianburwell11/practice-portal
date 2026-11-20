import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lazyPages', () => ({ loadApp: vi.fn(() => Promise.resolve({})) }));
vi.mock('../utils/url', () => ({ dataUrl: (k: string) => `/api/data/${k}` }));
vi.mock('../utils/docRevs', () => ({ fetchDoc: (k: string) => fetch(`/api/data/${k}`) }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function load() {
  vi.resetModules();
  return import('./prefetch');
}

function at(url: string) {
  window.history.replaceState(null, '', url);
}

describe('prefetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('discography.json')
        ? json({ songs: [{ id: 'abc123', slug: 'my-song' }] })
        : json({ url })),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    at('/');
  });

  const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);

  it('starts nothing off a band page', async () => {
    for (const path of ['/', '/help/x', '/legal/terms', '/admin', '/invite/t', '/account']) {
      at(path);
      (await load()).prefetchFromUrl();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for a guest link to open', async () => {
    at('/band?guest=tok');
    (await load()).prefetchFromUrl();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts only the registry for a band not seen before', async () => {
    at('/band');
    (await load()).prefetchFromUrl();
    expect(urls()).toEqual(['/api/data/registry.json']);
  });

  it('starts the band, its lists and the linked song for a remembered route', async () => {
    at('/band?song=my-song');
    const m = await load();
    m.rememberBandRoute('band', 'b1');
    m.prefetchFromUrl();
    await vi.waitFor(() => expect(urls()).toContain('/api/data/b1/songs/abc123/config.json'));
    expect(urls()).toEqual(expect.arrayContaining([
      '/api/data/registry.json', '/api/data/b1/band.json', '/api/data/b1/songs/discography.json', '/api/data/b1/setlists/index.json',
    ]));
    // The song list is still readable by whoever takes it.
    const res = await m.takePrefetched('b1/songs/discography.json')!;
    expect((await res.json()).songs).toHaveLength(1);
  });

  it('hands each response out once', async () => {
    at('/band');
    const m = await load();
    m.prefetchFromUrl();
    expect(m.takePrefetched('registry.json')).toBeDefined();
    expect(m.takePrefetched('registry.json')).toBeUndefined();
  });

  it('drops a response nobody took in time', async () => {
    vi.useFakeTimers();
    at('/band');
    const m = await load();
    m.prefetchFromUrl();
    vi.advanceTimersByTime(31_000);
    expect(m.takePrefetched('registry.json')).toBeUndefined();
  });

  it('fetches again when the prefetch failed', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    at('/band');
    const m = await load();
    m.prefetchFromUrl();
    const res = await m.prefetchedOr('registry.json', () => Promise.resolve(json({ again: true })));
    expect(await res.json()).toEqual({ again: true });
  });
});
