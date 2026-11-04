/**
 * The app's side of the offline cache (the worker is `sw/sw.ts`, the shared
 * storage `sw/store.ts`).
 *
 * On only in builds made with `VITE_OFFLINE_CACHE=1`. A build without it
 * removes a worker an earlier build installed and clears what it kept, so
 * turning the flag off is also a way to switch the cache off everywhere.
 */
import { CAP_BYTES, clearOffline, purgeBands, setLastVerified, usageBytes } from '../../sw/store';

export const OFFLINE_CACHE_ENABLED = import.meta.env.VITE_OFFLINE_CACHE === '1';
export const OFFLINE_CAP_BYTES = CAP_BYTES;

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined';

/** At startup: register the worker, or remove one left by an earlier build. */
export function setupOfflineCache(): void {
  if (!supported()) return;
  if (!OFFLINE_CACHE_ENABLED) {
    void navigator.serviceWorker.getRegistrations().then(async (regs) => {
      const ours = regs.filter((r) => (r.active ?? r.installing ?? r.waiting)?.scriptURL.endsWith('/sw.js'));
      if (ours.length === 0) return;
      await Promise.all(ours.map((r) => r.unregister()));
      await clearOffline();
    }).catch(() => undefined);
    return;
  }
  // `updateViaCache: 'none'`: every load checks for a new worker.
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
    console.warn('[offline] service worker not registered:', err);
  });
  // Ask the browser to keep the cache under storage pressure (granted
  // quietly for home screen apps and sites people use a lot).
  void navigator.storage?.persist?.().catch(() => undefined);
}

/**
 * After the band list loads: when it really came from the server (not the
 * offline copy), note the check-in (offline playback stops 30 days after the
 * last one) and drop cached songs of bands no longer on it (a band left, a
 * guest link gone).
 */
export function noteBandsVerified(response: Response, bandIds: readonly string[]): void {
  if (!OFFLINE_CACHE_ENABLED || !supported()) return;
  if (response.headers.get('X-Offline-Cache')) return;
  void (async () => {
    await setLastVerified();
    await purgeBands(new Set(bandIds));
  })().catch((err) => console.warn('[offline] check-in failed:', err));
}

/** Everything the offline cache holds, gone (sign-out, the Clear button). */
export async function clearOfflineCache(): Promise<void> {
  if (!supported()) return;
  await clearOffline().catch((err) => console.warn('[offline] clear failed:', err));
}

/** Bytes of songs kept offline. */
export async function offlineUsageBytes(): Promise<number> {
  if (!OFFLINE_CACHE_ENABLED || !supported()) return 0;
  return usageBytes().catch(() => 0);
}
