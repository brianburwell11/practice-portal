/**
 * Which panels a phone shows: chords, lyrics and the mixer start open, and
 * whatever the listener turns on or off is remembered on this device.
 */
export type PhonePanel = 'chords' | 'lyrics' | 'mixer';

const KEY = 'practice-portal.phonePanels';

function readAll(): Partial<Record<PhonePanel, boolean>> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Open unless this device has said otherwise. */
export function phonePanelOpen(panel: PhonePanel): boolean {
  if (typeof window === 'undefined') return true;
  const v = readAll()[panel];
  return typeof v === 'boolean' ? v : true;
}

export function rememberPhonePanel(panel: PhonePanel, open: boolean): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [panel]: open }));
  } catch { /* private mode: just don't remember */ }
}
