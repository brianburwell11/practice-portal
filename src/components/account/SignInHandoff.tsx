import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { isAndroid, isPhone, isStandalone } from '../../utils/homeScreen';

/**
 * Sign-in in the iPhone home screen app. Google's sign-in page doesn't work
 * there, nor in the in-app window the app can open, so every "Sign in" link
 * is caught here instead: the sign-in opens in Safari (`/app-sign-in`), where
 * you confirm the code this shows, and then this collects the session for the
 * app. See server/core/auth/handoff.ts.
 */

const START = '/api/auth/google/start';
/** Every few seconds while you're away signing in. */
const POLL_MS = 3000;

const needsHandoff = () => isStandalone() && isPhone() && !isAndroid();

/**
 * Open `url` in Safari itself. iOS 17 and later open `x-safari-https://`
 * links there; before that, the best we can do is the in-app window.
 */
function openInSafari(url: string): void {
  const ios = /OS (\d+)_/.exec(navigator.userAgent);
  if (ios && Number(ios[1]) >= 17) window.location.href = `x-safari-${url}`;
  else window.open(url, '_blank');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Pending {
  id: string;
  secret: string;
  /** Where the sign-in link was taking you, for afterwards. */
  next: string;
  /** The sign-in in Safari, opened again (or copied) from the buttons if the first didn't open. */
  windowUrl: string;
  code?: string;
  error?: string;
}

export function SignInHandoff() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    // Not in the sign-in window itself, should it ever count as the app.
    if (!needsHandoff() || window.location.pathname === '/app-sign-in') return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== START) return;
      e.preventDefault();
      e.stopPropagation();

      const id = randomToken();
      const secret = randomToken();
      const next = url.searchParams.get('next') ?? '/';
      const back = new URL(START, window.location.origin);
      back.searchParams.set('next', `/app-sign-in?id=${id}`);
      if (url.searchParams.get('terms') === '1') back.searchParams.set('terms', '1');
      // Opened now, while the tap still counts as one: after an await it'd be blocked.
      openInSafari(back.toString());
      setPending({ id, secret, next, windowUrl: back.toString() });
      setCopied(false);
      fetch('/api/auth/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, secret }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
          setPending((p) => (p?.id === id ? { ...p, code: data.code } : p));
        })
        .catch((err: Error) => setPending((p) => (p?.id === id ? { ...p, error: err.message } : p)));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const claim = useCallback(async () => {
    if (!pending?.code || busy.current) return;
    busy.current = true;
    try {
      const r = await fetch('/api/auth/handoff/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.id, secret: pending.secret }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPending((p) => p && { ...p, error: data.error ?? 'Sign-in failed. Please try again.' });
      } else if (data.status === 'done') {
        // The app has its own session now: start over where the link was going.
        window.location.assign(pending.next);
      }
    } catch {
      // Offline for a moment: the next poll tries again.
    } finally {
      busy.current = false;
    }
  }, [pending]);

  useEffect(() => {
    if (!pending?.code || pending.error) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') claim(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') claim(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [pending?.code, pending?.error, claim]);

  if (!pending) return null;
  return (
    <Modal onClose={() => setPending(null)} title="Finish signing in" showClose>
      {pending.error ? (
        <p className="text-sm text-red-300">{pending.error}</p>
      ) : (
        <>
          <p className="text-sm text-gray-300">
            Sign in with Google in Safari. It will ask you to confirm this code:
          </p>
          <p className="text-center font-mono text-4xl tracking-[0.3em] text-white" aria-live="polite">
            {pending.code ?? '····'}
          </p>
          <p className="text-sm text-gray-400">
            Then come back to this app. You’ll be signed in here.
          </p>
        </>
      )}
      <div className="space-y-2">
        {!pending.error && (
          <button
            onClick={() => openInSafari(pending.windowUrl)}
            className="w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200"
          >
            Open Safari again
          </button>
        )}
        {!pending.error && (
          <button
            onClick={() => navigator.clipboard.writeText(pending.windowUrl).then(() => setCopied(true))}
            className="w-full px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200"
          >
            {copied ? 'Copied. Paste it into Safari.' : 'Copy the sign-in link'}
          </button>
        )}
        <button
          onClick={() => setPending(null)}
          className="w-full px-4 py-2.5 rounded-lg text-sm text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
