/**
 * "Available offline": download everything a song or setlist needs, up
 * front, so it opens, plays and can be edited with no network.
 *
 * Every file is fetched through the service worker, which keeps it: song
 * documents (config, lyrics, chords, notes) in the shell cache, stems and
 * scores in the media cache under the exact `?v=` URL the player asks for.
 * Pinned songs are never evicted (`sw/store.ts`). The app's own files are
 * fetched too, from the build's `offline-assets.json`, so an editor never
 * opened before still loads on a plane.
 */
import { mediaIdentity } from '../../sw/eviction';
import { deletePin, enforceCap, MEDIA_CACHE, putPin, allPins, type Pin } from '../../sw/store';
import { stemUrl } from '../audio/mediaUrls';
import type { SetlistConfig, SongManifestEntry } from '../audio/types';
import { songScoreFiles } from '../components/sheet/scoreFiles';
import { setlistConfigSchema, songConfigSchema } from '../config/schema';
import { fetchDoc } from '../utils/docRevs';
import { dataUrl, r2Url } from '../utils/url';
import { OFFLINE_CACHE_ENABLED } from './offline';

export interface PinProgress {
  done: number;
  total: number;
}

type OnProgress = (p: PinProgress) => void;

export const songPinId = (band: string, songId: string) => `song:${band}/${songId}`;
export const setlistPinId = (band: string, setlistId: string) => `setlist:${band}/${setlistId}`;

/** Why pinning can't start here, or null if it can. */
export function pinUnavailableReason(): string | null {
  if (!OFFLINE_CACHE_ENABLED || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'Offline songs aren’t available in this browser.';
  }
  // The worker keeps what it fetches only once it controls this page, which
  // starts on the load after it was first installed.
  if (!navigator.serviceWorker.controller) return 'Reload the page, then try again.';
  return null;
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`Couldn’t download ${what} (${res.status})`);
  if (res.headers.get('X-Offline-Cache')) throw new Error('You’re offline. Connect to download.');
  return res;
}

/** The band's songs by id, for where each one's audio lives. */
async function discography(band: string): Promise<Map<string, SongManifestEntry>> {
  const res = await ok(await fetch(dataUrl(`${band}/songs/discography.json`)), 'the song list');
  const { songs } = await res.json() as { songs: SongManifestEntry[] };
  return new Map(songs.map((s) => [s.id, s]));
}

/**
 * Fetch a song's documents and work out every media file it needs. The
 * documents land in the worker's cache as a side effect of the fetch.
 */
async function prepareSong(band: string, entry: SongManifestEntry): Promise<{ title: string; urls: string[] }> {
  const res = await ok(await fetchDoc(`${band}/songs/${entry.id}/config.json`), `“${entry.title}”`);
  const config = songConfigSchema.parse(await res.json());
  // Lyrics, chords and notes may not exist; a 404 is fine.
  await Promise.all(['lyrics.json', 'chords.json', 'notes.json'].map((f) =>
    fetchDoc(`${band}/songs/${entry.id}/${f}`).then((r) => r.text()).catch(() => undefined)));

  const base = entry.audioBasePath ?? r2Url(`${band}/songs/${entry.id}`);
  const urls = config.stems.map((s) => stemUrl(base, s.file, config.mediaVersions));
  const score = songScoreFiles(band, config);
  if (score) urls.push(score.mxlUrl, ...(score.msczUrl ? [score.msczUrl] : []));
  // The worker only keeps versioned media; without a version the file
  // would download but not be kept.
  if (urls.some((u) => !new URL(u, location.href).searchParams.has('v'))) {
    throw new Error(`“${config.title}” can’t be kept offline yet. Try again in a minute.`);
  }
  return { title: config.title, urls };
}

/** The media cache's names for the songs these files belong to. */
function songKeys(urls: string[]): string[] {
  const keys = new Set<string>();
  for (const u of urls) {
    const id = mediaIdentity(new URL(u, location.href).pathname);
    if (id) keys.add(id.song);
  }
  return [...keys];
}

/** Fetch every URL (a few at a time), reading each body through so the worker keeps it. */
async function downloadAll(urls: string[], onProgress?: OnProgress, concurrency = 3): Promise<void> {
  let next = 0;
  let done = 0;
  onProgress?.({ done, total: urls.length });
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const res = await ok(await fetch(url), 'a file');
      await res.arrayBuffer();
      onProgress?.({ done: ++done, total: urls.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
}

/**
 * Wait until the worker has finished storing the media (it stores after
 * answering), so "ready" means it's really there.
 */
async function waitUntilKept(urls: string[], timeoutMs = 15_000): Promise<void> {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = urls.map((u) => { const url = new URL(u, location.href); return url.pathname + url.search; });
  const started = Date.now();
  for (;;) {
    const present = await Promise.all(keys.map((k) => cache.match(k).then(Boolean)));
    if (present.every(Boolean)) return;
    if (Date.now() - started > timeoutMs) throw new Error('Some files weren’t kept. Check your storage space and try again.');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** The app's own files and the band's shared documents, so the app opens offline. */
async function downloadShell(band: string): Promise<void> {
  await Promise.all([
    'registry.json', `${band}/band.json`, `${band}/songs/discography.json`, `${band}/setlists/index.json`,
  ].map((k) => fetch(dataUrl(k)).then((r) => r.text()).catch(() => undefined)));
  await fetch('/api/me').then((r) => r.text()).catch(() => undefined);
  try {
    const res = await fetch('/offline-assets.json');
    if (!res.ok) return; // dev server: no build list, nothing to keep
    const { files } = await res.json() as { files: string[] };
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        await fetch(f).then((r) => r.arrayBuffer()).catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  } catch {
    // Not fatal: the app's files already loaded are kept as they're used.
  }
}

/** Download a pin's songs and record it as ready. */
async function download(pin: Pin, entries: SongManifestEntry[], onProgress?: OnProgress): Promise<Pin> {
  await downloadShell(pin.band);
  const prepared = [];
  for (const entry of entries) prepared.push(await prepareSong(pin.band, entry));
  const urls = prepared.flatMap((p) => p.urls);
  await downloadAll(urls, onProgress);
  await waitUntilKept(urls);
  const done: Pin = { ...pin, songs: songKeys(urls), ready: true, syncedAt: Date.now() };
  await putPin(done);
  return done;
}

/** Make one song available offline. */
export async function pinSong(band: string, entry: SongManifestEntry, onProgress?: OnProgress): Promise<Pin> {
  const reason = pinUnavailableReason();
  if (reason) throw new Error(reason);
  void navigator.storage?.persist?.().catch(() => undefined);
  const existing = (await allPins()).find((p) => p.id === songPinId(band, entry.id));
  const pin: Pin = existing ?? {
    id: songPinId(band, entry.id), kind: 'song', band, target: entry.id, label: entry.title,
    songs: [], ready: false, pinnedAt: Date.now(),
  };
  await putPin(pin);
  return download(pin, [entry], onProgress);
}

/** The setlist's songs, in order, as the band's song list has them. */
function setlistSongs(setlist: SetlistConfig, songs: Map<string, SongManifestEntry>): SongManifestEntry[] {
  const ids = [...new Set(setlist.entries.flatMap((e) => (e.type === 'song' ? [e.songId] : [])))];
  return ids.map((id) => songs.get(id)).filter((s): s is SongManifestEntry => !!s);
}

/** Make every song in a setlist available offline. */
export async function pinSetlist(band: string, setlist: SetlistConfig, onProgress?: OnProgress): Promise<Pin> {
  const reason = pinUnavailableReason();
  if (reason) throw new Error(reason);
  void navigator.storage?.persist?.().catch(() => undefined);
  // The setlist itself, so it opens offline.
  await ok(await fetchDoc(`${band}/setlists/${setlist.id}.json`), `“${setlist.name}”`).then((r) => r.text());
  const existing = (await allPins()).find((p) => p.id === setlistPinId(band, setlist.id));
  const pin: Pin = existing ?? {
    id: setlistPinId(band, setlist.id), kind: 'setlist', band, target: setlist.id, label: setlist.name,
    songs: [], ready: false, pinnedAt: Date.now(),
  };
  await putPin(pin);
  return download(pin, setlistSongs(setlist, await discography(band)), onProgress);
}

/** Stop keeping it offline. Its files stay as ordinary played songs, evicted as usual. */
export async function unpin(id: string): Promise<void> {
  await deletePin(id);
  await enforceCap();
}

/**
 * Bring pinned songs up to date (a new stem, edited lyrics, a setlist with a
 * new song), after the app has really reached the server. Quiet: a failure
 * leaves the pin as it was, to try again next time.
 */
export async function refreshPins(onPin?: (pin: Pin) => void): Promise<void> {
  if (pinUnavailableReason()) return;
  const pins = await allPins();
  const byBand = new Map<string, Map<string, SongManifestEntry>>();
  for (const pin of pins) {
    try {
      let songs = byBand.get(pin.band);
      if (!songs) { songs = await discography(pin.band); byBand.set(pin.band, songs); }
      let entries: SongManifestEntry[];
      if (pin.kind === 'setlist') {
        const res = await ok(await fetchDoc(`${pin.band}/setlists/${pin.target}.json`), `“${pin.label}”`);
        const setlist = setlistConfigSchema.parse(await res.json());
        entries = setlistSongs(setlist, songs);
        pin.label = setlist.name;
      } else {
        const entry = songs.get(pin.target);
        if (!entry) continue; // deleted or renamed: left as it was
        entries = [entry];
        pin.label = entry.title;
      }
      onPin?.(await download(pin, entries));
    } catch (err) {
      console.warn('[offline] couldn’t refresh', pin.id, err);
    }
  }
}
