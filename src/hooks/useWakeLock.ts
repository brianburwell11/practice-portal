import { useEffect } from 'react';

/**
 * Keeps the screen on while `active` (Screen Wake Lock API), so a phone on a
 * music stand doesn't dim mid-song. The browser drops the lock whenever the
 * page is hidden, so it is asked for again on coming back. Where the API is
 * missing it does nothing.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) { void next.release(); return; }
        lock = next;
      } catch {
        // Refused (low battery, no user gesture yet): the screen just dims as usual.
      }
    };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', request);
      if (lock && !lock.released) void lock.release();
    };
  }, [active]);
}
