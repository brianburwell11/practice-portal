/** Whether this is a phone, whether it's the home screen app, and Chrome's install prompt. */
import { useSyncExternalStore } from 'react';

/** Already running from the home screen. */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isAndroid = () => /android/i.test(navigator.userAgent);

/** Phones and tablets. iPads say they're Macs, but Macs have no touch screen. */
export const isPhone = () =>
  /iphone|ipad|ipod|android/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /macintosh/i.test(navigator.userAgent));

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

// Chrome fires this once, early, so it's caught when this module loads.
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  changed();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  changed();
});

/**
 * Chrome's install prompt, when it has offered one: call it to show the
 * install sheet. It can be used once.
 */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const event = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => installPrompt,
  );
  if (!event) return null;
  return () => {
    installPrompt = null;
    changed();
    return event.prompt();
  };
}
