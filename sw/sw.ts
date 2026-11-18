/// <reference lib="webworker" />
/**
 * Practice Portal's service worker: the offline cache. Built to
 * `public/sw.js` by `npm run build:sw`, registered by `src/offline/offline.ts`
 * only when the app is built with `VITE_OFFLINE_CACHE=1`.
 *
 * - Songs (stems and scores) are kept as they're played, under their plain
 *   same-origin URL with its `?v=` content version, never under a signed R2
 *   URL. A new version is a new key, so a replaced file is fetched afresh.
 *   Unversioned media isn't kept. At most this device's cap (`capBytes`,
 *   500 MB unless changed), least recently played songs dropped first.
 * - Hashed app assets: from the cache first (they never change).
 * - Pages, `/api/data` and `/api/me`: from the network first, the cached copy
 *   when offline, when the server takes longer than `NETWORK_TIMEOUT_MS` or
 *   answers with a 5xx (marked `X-Offline-Cache: 1`, so the app knows it
 *   hasn't really reached the server).
 * - Root-level files (manifest, icons, the SoundTouch processor): from the
 *   network first, cached for offline.
 * - Nothing else (sign-in, admin, writes, other origins, dev-server modules)
 *   is touched.
 *
 * Sign-out, leaving a band and the 30-day rule are enforced by the app
 * through the shared store (`sw/store.ts`), and here for the 30 days.
 * Kill switch: `OFFLINE_CACHE_DISABLED=1` on the server replaces this file
 * with one that clears everything and unregisters (`server/main.ts`).
 */
import { mediaIdentity } from './eviction';
import {
  CACHE_PREFIX, enforceCap, lastVerified, MEDIA_CACHE, OFFLINE_GRACE_MS, putEntry, SHELL_CACHE, touchEntry,
} from './store';

declare const self: ServiceWorkerGlobalScope;

/** The latest page (index.html), for opening the app offline. */
const SHELL_PAGE = '/__offline-shell';

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Caches from older versions of this worker.
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== MEDIA_CACHE && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith('/api/media/')) {
    if (url.searchParams.has('v') && mediaIdentity(path)) event.respondWith(media(event, req, url));
    return;
  }
  if (path === '/api/me' || path.startsWith('/api/data/')) {
    event.respondWith(networkFirst(event, req, req.url));
    return;
  }
  if (path.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event, req, SHELL_PAGE));
    return;
  }
  if (path.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Root-level files the app needs (the manifest, icons, the SoundTouch
  // processor). Nothing deeper: in development that would be every source
  // module the dev server hands out.
  if (path !== '/sw.js' && /^\/[^/]+\.[A-Za-z0-9]+$/.test(path)) {
    event.respondWith(networkFirst(event, req, req.url));
  }
});

/** Kept only if it's a whole, plain, successful response from our own server. */
function storable(res: Response): boolean {
  return res.status === 200 && (res.type === 'basic' || res.type === 'default');
}

/** A cached copy, marked so the app can tell it didn't reach the server. */
function markedOffline(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('X-Offline-Cache', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * How long to wait for the server before answering from the cache. Wifi
 * that's "connected" without reaching anything (a plane, a hotel, a server
 * that can't reach its database) doesn't fail, it just never answers.
 */
const NETWORK_TIMEOUT_MS = 6_000;
/** After a request fails or times out, how long to answer from the cache straight away. */
const OFFLINE_HOLD_MS = 20_000;
/** Until when requests skip waiting for the network (it just failed). */
let offlineUntil = 0;

/** The server's own failure (it's up, but can't do its job): as good as offline. */
const serverFailed = (res: Response) => res.status >= 500;

async function networkFirst(event: FetchEvent, req: Request, cacheKey: string): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(req).then(async (res) => {
    if (storable(res)) await cache.put(cacheKey, res.clone());
    if (serverFailed(res)) offlineUntil = Date.now() + OFFLINE_HOLD_MS;
    else offlineUntil = 0;
    return res;
  }, (err: unknown) => {
    offlineUntil = Date.now() + OFFLINE_HOLD_MS;
    throw err;
  });
  // Whatever happens below, let the request finish and refresh the cache.
  event.waitUntil(network.then(() => undefined, () => undefined));

  const cached = async () => {
    const hit = await cache.match(cacheKey);
    return hit ? markedOffline(hit) : null;
  };

  // The network just failed: the cached copy now, if there is one.
  if (Date.now() < offlineUntil) {
    const hit = await cached();
    if (hit) return hit;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS); });
  try {
    const first = await Promise.race([network, timedOut]);
    if (first === 'timeout') {
      offlineUntil = Date.now() + OFFLINE_HOLD_MS;
      return (await cached()) ?? (await network);
    }
    if (serverFailed(first)) return (await cached()) ?? first;
    return first;
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(req: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) await cache.put(req.url, res.clone());
  return res;
}

async function media(event: FetchEvent, req: Request, url: URL): Promise<Response> {
  const id = mediaIdentity(url.pathname)!;
  const key = url.pathname + url.search;
  const cache = await caches.open(MEDIA_CACHE);

  // Past the grace period without the app reaching the server, cached songs
  // aren't played: this device may no longer be allowed them.
  const verified = await lastVerified().catch(() => null);
  const fresh = verified === null || Date.now() - verified < OFFLINE_GRACE_MS;

  if (fresh) {
    const hit = await cache.match(key);
    if (hit) {
      event.waitUntil(touchEntry(key).catch(() => undefined));
      return hit;
    }
  }

  // The media route redirects to a signed R2 URL; the file is kept under the
  // plain URL instead. Rebuilt as a fresh response (no redirect, no signed URL).
  const res = await fetch(req);
  if (res.status !== 200) return res;
  const blob = await res.blob();
  const headers = {
    'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
    'Content-Length': String(blob.size),
  };
  if (fresh) {
    event.waitUntil((async () => {
      await cache.put(key, new Response(blob, { headers }));
      await putEntry({ key, bytes: blob.size, band: id.band, song: id.song, lastUsed: Date.now() });
      await enforceCap(id.song);
    })().catch((err) => console.warn('[sw] could not keep', key, err)));
  }
  return new Response(blob, { headers });
}
