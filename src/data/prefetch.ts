import { dataUrl } from '../utils/url';
import { fetchDoc } from '../utils/docRevs';
import { loadApp } from '../lazyPages';

/**
 * Starts a band page's documents downloading together, instead of one after
 * another as each component mounts. Opening a song from a link used to wait
 * on: registry → band → the player's code → song list → song config → stems.
 *
 * - The registry starts as soon as the page loads.
 * - The band's id is remembered per route on this device, so on a return
 *   visit the band, song list and setlist index start alongside the registry.
 *   On a first visit they start once the registry names the id (`prefetchBand`).
 * - The player's code starts with them.
 * - Once the song list arrives, the config of the song in `?song=` starts.
 *
 * Components take a response with `takePrefetched`, once. Anything not taken
 * soon is dropped, so a later read never gets an old copy.
 */

const MAX_AGE_MS = 30_000;
const ROUTE_IDS_KEY = 'practice-portal.bandRouteIds';

/** Top-level paths that aren't bands (src/main.tsx). */
const NOT_BANDS = new Set(['invite', 'app-sign-in', 'account', 'email', 'help', 'legal', 'admin']);

const pending = new Map<string, { at: number; res: Promise<Response> }>();
const startedBands = new Set<string>();

function start(key: string, load: () => Promise<Response>): Promise<Response> {
  const res = load();
  res.catch(() => {}); // a failure is seen by whoever takes it
  pending.set(key, { at: Date.now(), res });
  return res;
}

/**
 * The prefetched response for a document key, if one is waiting (and fresh).
 * Each one is handed out once. If its download failed, the caller fetches as usual.
 */
export function takePrefetched(key: string): Promise<Response> | undefined {
  const hit = pending.get(key);
  if (!hit) return undefined;
  pending.delete(key);
  if (Date.now() - hit.at > MAX_AGE_MS) return undefined;
  return hit.res;
}

function routeIds(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ROUTE_IDS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Remember which band a route is, for the next visit. */
export function rememberBandRoute(route: string, id: string): void {
  try {
    const ids = routeIds();
    if (ids[route] === id) return;
    ids[route] = id;
    localStorage.setItem(ROUTE_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: only the next visit is slower.
  }
}

/** The prefetched response for `key` if one is waiting, else (or if it failed) `load()`. */
export function prefetchedOr(key: string, load: () => Promise<Response>): Promise<Response> {
  const hit = takePrefetched(key);
  return hit ? hit.catch(() => load()) : load();
}

/** The band's documents, the player's code, and the linked song's config. */
export function prefetchBand(bandId: string): void {
  if (startedBands.has(bandId)) return;
  startedBands.add(bandId);
  const params = new URLSearchParams(window.location.search);
  const onPlayer = !/\/admin\//.test(window.location.pathname);

  start(`${bandId}/band.json`, () => fetch(dataUrl(`${bandId}/band.json`)));
  start(`${bandId}/setlists/index.json`, () => fetch(dataUrl(`${bandId}/setlists/index.json`)));
  const discography = start(`${bandId}/songs/discography.json`, () => fetch(dataUrl(`${bandId}/songs/discography.json`)));

  if (!onPlayer) return;
  loadApp().catch(() => {});

  // A song link outside a setlist names the song by slug (or legacy id).
  const songKey = params.get('song');
  if (!songKey || params.get('setlist')) return;
  discography
    .then((r) => (r.ok ? r.clone().json() : null))
    .then((data: { songs?: { id: string; slug?: string }[] } | null) => {
      const songs = data?.songs ?? [];
      const entry = songs.find((s) => s.slug === songKey) ?? songs.find((s) => s.id === songKey);
      if (!entry) return;
      const key = `${bandId}/songs/${entry.id}/config.json`;
      start(key, () => fetchDoc(key));
    })
    .catch(() => {});
}

/** Called once at startup: on a band page, start its documents now. */
export function prefetchFromUrl(): void {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = base && window.location.pathname.startsWith(base) ? window.location.pathname.slice(base.length) : window.location.pathname;
  const segment = decodeURIComponent(path.split('/')[1] ?? '');
  if (!segment || NOT_BANDS.has(segment)) return;
  // A guest link changes what this browser may see, so it loads first.
  if (new URLSearchParams(window.location.search).has('guest')) return;
  start('registry.json', () => fetch(dataUrl('registry.json')));
  const known = routeIds()[segment];
  if (known) prefetchBand(known);
}
