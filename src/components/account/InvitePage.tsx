import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ROLE_LABELS, signInHref, useSessionStore, type BandRole } from '../../store/sessionStore';
import { GoogleMark } from './AccountMenu';

interface Preview {
  band: { id: string; slug: string; name: string };
  role: BandRole;
  invitedBy: string | null;
  email: string | null;
  expiresAt: string;
  status: 'valid' | 'expired' | 'used' | 'revoked';
}

const STATUS_MESSAGES: Record<Exclude<Preview['status'], 'valid'>, string> = {
  expired: 'This invite has expired. Ask whoever sent it for a new link.',
  used: 'This invite has already been used.',
  revoked: 'This invite was cancelled.',
};

/** `/invite/<token>` — see what you're invited to, sign in, join. */
export function InvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const { loaded, user, load } = useSessionStore();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    load();
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? 'This invite link isn’t valid');
        setPreview(data);
      })
      .catch((err) => setError(err.message));
  }, [token, load]);

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Couldn’t join');
      await useSessionStore.getState().load();
      // A full load, so the band list includes a Members-only band you just joined.
      window.location.assign(`/${data.band.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setJoining(false);
    }
  };

  const here = `/invite/${token}`;
  const wrongAccount = !!(user && preview?.email && preview.email.toLowerCase() !== user.email.toLowerCase());

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-gray-800/60 border border-gray-700 rounded-xl p-6 space-y-5 text-center">
        {!preview && !error && <p className="text-gray-400">Loading invite…</p>}

        {preview && (
          <>
            <div className="space-y-1">
              <p className="text-sm text-gray-400">
                {preview.invitedBy ? `${preview.invitedBy} invited you to` : 'You’re invited to'}
              </p>
              <h1 className="text-2xl font-bold">{preview.band.name}</h1>
              <p className="text-sm text-gray-400">as {ROLE_LABELS[preview.role]}</p>
            </div>

            {preview.status !== 'valid' ? (
              <p className="text-amber-300 text-sm">{STATUS_MESSAGES[preview.status]}</p>
            ) : !loaded ? null : !user ? (
              <>
                {preview.email && (
                  <p className="text-xs text-gray-400">This invite is for <span className="text-gray-200">{preview.email}</span>.</p>
                )}
                <a
                  href={signInHref(here)}
                  className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-white text-gray-800 font-medium hover:bg-gray-100"
                >
                  <GoogleMark />
                  Sign in with Google to join
                </a>
              </>
            ) : wrongAccount ? (
              <>
                <p className="text-sm text-amber-300">
                  This invite is for {preview.email}, but you’re signed in as {user.email}.
                </p>
                <a href={signInHref(here)} className="block w-full px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm">
                  Use a different Google account
                </a>
              </>
            ) : (
              <button
                onClick={join}
                disabled={joining}
                className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium text-white"
              >
                {joining ? 'Joining…' : `Join as ${user.email}`}
              </button>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Link to="/" className="inline-block text-xs text-gray-500 hover:text-gray-300">
          Go to Practice Portal
        </Link>
      </div>
    </div>
  );
}
