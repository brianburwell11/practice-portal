import { create } from 'zustand';

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
  load: () => Promise<void>;
  signOut: () => Promise<void>;
  roleIn: (bandId: string | undefined) => BandRole | null;
}

let inflight: Promise<void> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  available: false,
  loaded: false,
  user: null,
  bands: [],

  load: () => {
    inflight ??= fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { signInEnabled?: boolean; user: SessionUser | null; bands: SessionBand[] } | null) => {
        set({
          available: !!data?.signInEnabled,
          user: data?.user ?? null,
          bands: data?.bands ?? [],
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
}));

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
