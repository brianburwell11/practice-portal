import { useEffect, useState, type ReactNode } from 'react';
import { signInHref, type SessionUser } from '../../store/sessionStore';
import { GoogleMark } from './AccountMenu';

interface Access {
  band: { id: string; slug: string; name: string; logo: string | null; visibility: 'public' | 'private' };
  member: boolean;
  request: { status: 'pending' | 'approved' | 'declined'; createdAt: string; decidedAt: string | null } | null;
  canRequest: boolean;
  retryAt: string | null;
}

const MESSAGE_MAX = 100;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

/**
 * A visitor at a Members-only band they aren't in: the band's name and logo.
 * Signed out, a way to sign in; signed in, a way to ask to join — the Owner is
 * emailed and answers in Members & Sharing. Renders `fallback` when there's no
 * band at this address.
 */
export function RequestAccess({ slug, user, fallback }: { slug: string; user: SessionUser | null; fallback: ReactNode }) {
  const [access, setAccess] = useState<Access | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/access/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAccess)
      .catch(() => setAccess(null));
  }, [slug]);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/access/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Couldn’t send the request');
      setAccess((a) => a && {
        ...a, canRequest: false, request: { status: 'pending', createdAt: new Date().toISOString(), decidedAt: null },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (access === undefined) return null;
  if (access === null || access.band.visibility !== 'private') return <>{fallback}</>;
  const { band, request } = access;

  return (
    <div className="max-w-sm w-full text-center space-y-4">
      {band.logo && <img src={band.logo} alt="" className="mx-auto max-h-20 max-w-[12rem] object-contain" />}
      <h1 className="text-xl font-semibold">{band.name}</h1>

      {!user ? (
        <>
          <p className="text-sm text-gray-400">This band is Members only. Sign in to see it if you’re a member, or to ask to join.</p>
          <a
            href={signInHref()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white text-gray-800 font-medium hover:bg-gray-100"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        </>
      ) : access.member ? (
        <>
          <p className="text-sm text-gray-400">You’re in this band now.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white">
            Open {band.name}
          </button>
        </>
      ) : request?.status === 'pending' ? (
        <p className="text-sm text-gray-400">
          You asked to join on {day(request.createdAt)}. You’ll get an email at {user.email} when the band answers.
        </p>
      ) : access.canRequest ? (
        <>
          <p className="text-sm text-gray-400">
            This band is Members only. Ask to join, and the band’s Owner will get an email. They’ll see your name and{' '}
            {user.email}.
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={MESSAGE_MAX}
            rows={3}
            placeholder="Add a message (optional)"
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={send}
            disabled={sending}
            className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium text-white"
          >
            {sending ? 'Sending…' : 'Request access'}
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-400">
          The band didn’t approve your last request.
          {access.retryAt && ` You can ask again after ${day(access.retryAt)}.`}
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
