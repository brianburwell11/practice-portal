import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { signInHref, useSessionStore } from '../../store/sessionStore';
import { useBandStore } from '../../store/bandStore';

interface Props {
  /** A capability in the band on screen, or 'platformAdmin' for site-wide pages. */
  need: string;
  children: ReactNode;
}

/**
 * Guard for an admin page. UX only — the server refuses the page's requests
 * on its own — but it saves someone filling in a form that can't be saved.
 */
export function RequireCan({ need, children }: Props) {
  const { loaded, user, load, can, platformAdmin } = useSessionStore();
  const bandId = useBandStore((s) => s.currentBand?.id);
  const bandRoute = useBandStore((s) => s.currentBand?.route);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return <div className="min-h-screen bg-page text-gray-400 p-8">Loading…</div>;

  const allowed = need === 'platformAdmin' ? platformAdmin : can(bandId, need);
  if (allowed) return <>{children}</>;

  return (
    <div className="min-h-screen bg-page text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-semibold">{user ? 'You don’t have access to this' : 'Sign in to continue'}</h1>
        <p className="text-sm text-gray-400">
          {user
            ? `Your role in this band doesn’t include it. Ask the band’s Owner or a Manager.`
            : 'This page is for band members who manage songs.'}
        </p>
        {!user && (
          <a href={signInHref()} className="inline-block px-4 py-2 rounded-lg bg-white text-gray-800 font-medium hover:bg-gray-100">
            Sign in with Google
          </a>
        )}
        <div>
          <Link to={bandRoute ? `/${bandRoute}` : '/'} className="text-xs text-gray-500 hover:text-gray-300">Back</Link>
        </div>
      </div>
    </div>
  );
}
