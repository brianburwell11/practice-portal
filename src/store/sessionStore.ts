import { create } from 'zustand';
import { useBandStore } from './bandStore';

export type BandRole = 'owner' | 'manager' | 'editor' | 'member';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface SessionBand {
  /** Legacy band id — the same `id` as `BandConfig.id`. */
  id: string;
  slug: string;
  name: string;
  role: BandRole;
  /** What this role may do here — the server's `role_capability` rows. */
  capabilities: string[];
}

/** A band's guest link opened on this device (Phase 10): read access to that band. */
export interface GuestAccess {
  /** `id` is the legacy band id, as in `SessionBand`. */
  band: { id: string; slug: string; name: string };
  /** Null: no expiry. */
  expiresAt: string | null;
}

interface SessionState {
  /**
   * Whether this deployment has accounts at all. False on static hosts
   * (GitHub Pages has no `/api/me`) and on a server without Google
   * configured; the sign-in UI hides itself either way.
   */
  available: boolean;
  loaded: boolean;
  user: SessionUser | null;
  bands: SessionBand[];
  /** In ADMIN_EMAILS: the /admin dashboard, and the Owner's powers in every band. */
  platformAdmin: boolean;
  /** A site admin's capabilities in bands they aren't in (the Owner's). Empty for everyone else. */
  supportCapabilities: string[];
  /** Guest links opened on this device, signed in or not. */
  guest: GuestAccess[];
  load: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Forget every guest link on this device. */
  leaveGuest: () => Promise<void>;
  /** Leave a band you're a member of (not one you own). Throws the server's message. */
  leaveBand: (bandId: string) => Promise<void>;
  /** Delete the signed-in account. Throws the server's message (an Owner must hand on their bands first). */
  deleteAccount: () => Promise<void>;
  guestIn: (bandId: string | undefined) => GuestAccess | null;
  roleIn: (bandId: string | undefined) => BandRole | null;
  /** What the signed-in user may do in the band: their role's capabilities, or a site admin's support access. */
  capabilitiesIn: (bandId: string | undefined) => string[] | undefined;
  /**
   * UX only — whether to show a control. The server checks every request
   * itself; hiding a button is never what keeps anyone out.
   */
  can: (bandId: string | undefined, capability: string) => boolean;
}

let inflight: Promise<void> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  available: false,
  loaded: false,
  user: null,
  bands: [],
  platformAdmin: false,
  supportCapabilities: [],
  guest: [],

  load: () => {
    inflight ??= fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {
        signInEnabled?: boolean; user: SessionUser | null; bands: SessionBand[]; platformAdmin?: boolean;
        supportCapabilities?: string[]; guest?: GuestAccess[];
      } | null) => {
        set({
          available: !!data?.signInEnabled,
          user: data?.user ?? null,
          bands: data?.bands ?? [],
          platformAdmin: !!data?.platformAdmin,
          supportCapabilities: data?.supportCapabilities ?? [],
          guest: data?.guest ?? [],
          loaded: true,
        });
      })
      // No API here (static hosting) — accounts simply don't exist.
      .catch(() => set({ available: false, loaded: true }));
    return inflight;
  },

  signOut: async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    // A full load of the home page, so every cached band list and document is
    // refetched as anonymous — and a Members-only band isn't left on screen.
    window.location.assign('/');
  },

  leaveGuest: async () => {
    await fetch('/api/guest', { method: 'DELETE' });
    // A Members-only band reached through the link is no longer readable.
    window.location.assign('/');
  },

  leaveBand: async (bandId) => {
    const userId = get().user?.id;
    if (!userId) return;
    const res = await fetch(`/api/bands/${bandId}/members/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Couldn’t leave the band');
    }
    // As with signing out: a Members-only band isn't left on screen.
    window.location.assign('/');
  },

  deleteAccount: async () => {
    const res = await fetch('/api/me', { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Couldn’t delete the account');
    }
    window.location.assign('/');
  },

  guestIn: (bandId) => get().guest.find((g) => g.band.id === bandId) ?? null,

  roleIn: (bandId) => get().bands.find((b) => b.id === bandId)?.role ?? null,

  capabilitiesIn: (bandId) => {
    const { bands, platformAdmin, supportCapabilities } = get();
    const mine = bands.find((b) => b.id === bandId)?.capabilities;
    return mine ?? (platformAdmin && bandId ? supportCapabilities : undefined);
  },

  can: (bandId, capability) => !!get().capabilitiesIn(bandId)?.includes(capability),
}));

/** Whether the signed-in user holds `capability` in the band on screen. UX only. */
export function useCan(capability: string): boolean {
  const bandId = useBandStore((s) => s.currentBand?.id);
  return useSessionStore((s) => s.can(bandId, capability));
}

/**
 * Full-page hop to Google; comes back to `next` (defaults to here). `agreeing`
 * marks a button shown with the terms notice (`AgreeNotice`): signing in from
 * it records that the user agreed to the current terms.
 */
export function signInHref(next = window.location.pathname + window.location.search, agreeing = false): string {
  return `/api/auth/google/start?next=${encodeURIComponent(next)}${agreeing ? '&terms=1' : ''}`;
}

export const ROLE_LABELS: Record<BandRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  editor: 'Editor',
  member: 'Member',
};
