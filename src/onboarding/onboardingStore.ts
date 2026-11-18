import { create } from 'zustand';

/**
 * First-run help on the band page: a short tour the first time someone opens
 * a song, and labels on every control (the header's ? button, or the ? key)
 * any time after.
 *
 * Controls opt in with attributes, so the help follows the real UI:
 * - `data-help="What it does"` labels a control. Labels with the same text
 *   show once (the first visible one), so every part's M and S share a label.
 * - `data-tour="<step>"` is where a tour step points (see `Tour.tsx`).
 */
interface OnboardingState {
  /** The ? panel: labels on every control, and a bar with the tour, shortcuts and guides. */
  labelsOpen: boolean;
  /** The keyboard shortcuts, opened out in the ? panel's bar. */
  shortcutsShown: boolean;
  tourOpen: boolean;
  showLabels: (opts?: { shortcuts?: boolean }) => void;
  hideLabels: () => void;
  toggleLabels: () => void;
  toggleShortcuts: () => void;
  startTour: () => void;
  endTour: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  labelsOpen: false,
  shortcutsShown: false,
  tourOpen: false,
  showLabels: (opts) => set({ labelsOpen: true, shortcutsShown: !!opts?.shortcuts, tourOpen: false }),
  hideLabels: () => set({ labelsOpen: false, shortcutsShown: false }),
  toggleLabels: () => set((s) => ({ labelsOpen: !s.labelsOpen, shortcutsShown: false, tourOpen: false })),
  toggleShortcuts: () => set((s) => ({ shortcutsShown: !s.shortcutsShown })),
  startTour: () => set({ tourOpen: true, labelsOpen: false, shortcutsShown: false }),
  endTour: () => set({ tourOpen: false }),
}));

/** Bump to show the tour again to everyone (after it changes a lot). */
const TOUR_VERSION = 1;
const tourKey = (person: string) => `practice-portal.tour.v${TOUR_VERSION}:${person}`;

/** Whether `person` (a user id, or `device` when signed out) has had the tour on this device. */
export function tourSeen(person: string): boolean {
  try {
    return window.localStorage.getItem(tourKey(person)) === '1';
  } catch {
    // Storage blocked: don't show it on every song.
    return true;
  }
}

export function markTourSeen(person: string): void {
  try {
    window.localStorage.setItem(tourKey(person), '1');
  } catch {
    // Nothing to do; it may show again next visit.
  }
}

/** The first drawn element matching `selector`, if any (it may be scrolled out of view). */
export function firstVisible(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    if (isShown(el, false)) return el;
  }
  return null;
}

/**
 * Drawn: not `display: none` (itself or an ancestor), not zero-sized, not
 * hidden. With `inView`, also at least partly inside the viewport.
 */
export function isShown(el: HTMLElement, inView = true): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (inView && (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (check) return check.call(el, { visibilityProperty: true, opacityProperty: true });
  return getComputedStyle(el).visibility !== 'hidden';
}

/** Typing somewhere: single-key shortcuts stand down. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
