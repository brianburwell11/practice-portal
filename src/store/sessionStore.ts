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
  /** In ADMIN_EMAILS: may create bands. */
  platformAdmin: boolean;
  load: () => Promise<void>;
  signOut: () => Promise<void>;
  roleIn: (bandId: string | undefined) => BandRole | null;
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

  load: () => {
    inflight ??= fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { signInEnabled?: boolean; user: SessionUser | null; bands: SessionBand[]; platformAdmin?: boolean } | null) => {
        set({
          available: !!data?.signInEnabled,
          user: data?.user ?? null,
          bands: data?.bands ?? [],
          platformAdmin: !!data?.platformAdmin,
          loaded: true,
        });
      })
      // No API here (static hosting) — accounts simply don't exist.
      .catch(() => set({ available: false, loaded: true }));
    return inflight;
  },

  signOut: async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    // Reload so every cached band list and document is refetched as anonymous.
    window.location.reload();
  },

  roleIn: (bandId) => get().bands.find((b) => b.id === bandId)?.role ?? null,

  can: (bandId, capability) =>
    !!get().bands.find((b) => b.id === bandId)?.capabilities.includes(capability),
}));

/** Whether the signed-in user holds `capability` in the band on screen. UX only. */
export function useCan(capability: string): boolean {
  const bandId = useBandStore((s) => s.currentBand?.id);
  return useSessionStore((s) => s.can(bandId, capability));
}

/** Full-page hop to Google; comes back to `next` (defaults to here). */
export function signInHref(next = window.location.pathname + window.location.search): string {
  return `/api/auth/google/start?next=${encodeURIComponent(next)}`;
}

export const ROLE_LABELS: Record<BandRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  editor: 'Editor',
  member: 'Member',
};
