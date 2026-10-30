import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS, signInHref, useSessionStore } from '../../store/sessionStore';

interface Props {
  /** Current band's legacy id, to show your role in it. */
  bandId?: string;
}

/**
 * Sign-in button, or the signed-in user's avatar and menu. Renders nothing
 * where accounts don't exist (static hosting, or no Google client configured).
 * A sub here through a guest link gets a "Guest" chip beside sign-in.
 */
export function AccountMenu({ bandId }: Props) {
  const {
    available, loaded, user, load, signOut, roleIn, guestIn, leaveGuest, leaveBand, platformAdmin, bands,
  } = useSessionStore();
  const [open, setOpen] = useState(false);
  // Leaving a band takes a second click, and shows the server's refusal if any.
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Google sends errors back as ?signin_error=… — show it once.
  const [signInError, setSignInError] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('signin_error'),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  // ...then tidy the URL so a reload doesn't show it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('signin_error')) return;
    params.delete('signin_error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  useEffect(() => {
    if (!open) return;
    // A press anywhere else (mouse, touch or pen) or Escape closes it.
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const banner = signInError && (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] bg-red-900/90 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-100 shadow-xl flex items-start gap-3">
      <span className="flex-1">{signInError}</span>
      <button onClick={() => setSignInError(null)} className="text-red-300 hover:text-white" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );

  const guest = guestIn(bandId);
  const until = guest?.expiresAt && new Date(guest.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (!loaded || (!available && !guest)) return banner || null;

  if (!user) {
    return (
      <div ref={ref} className="relative flex items-center gap-2">
        {banner}
        {guest && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="px-2.5 py-1 rounded-full bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 shrink-0"
            aria-expanded={open}
          >
            Guest{until && <span className="hidden sm:inline"> · until {until}</span>}
          </button>
        )}
        {guest && open && (
          <div className="absolute right-0 top-full mt-2 w-64 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-2 text-sm text-gray-200">
            <p className="px-4 py-2 text-gray-400">
              A link from {guest.band.name} lets this device play its songs{until ? ` until ${until}` : ''}.
            </p>
            <button onClick={() => leaveGuest()} className="w-full text-left px-4 py-2 hover:bg-gray-800">
              Leave on this device
            </button>
          </div>
        )}
        {available && (
          <a
            href={signInHref()}
            aria-label="Sign in with Google"
            className="inline-flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full bg-white text-gray-800 text-sm font-medium shadow hover:bg-gray-100 shrink-0"
          >
            <GoogleMark />
            {/* Just the G on phones, where the header is already full. */}
            <span className="hidden sm:inline">Sign in</span>
          </a>
        )}
      </div>
    );
  }

  const role = roleIn(bandId);
  const bandName = bands.find((b) => b.id === bandId)?.name ?? 'this band';

  return (
    <div ref={ref} className="relative">
      {banner}
      <button
        onClick={() => {
          setOpen((o) => !o);
          setConfirming(false);
          setConfirmError(null);
        }}
        className="flex items-center rounded-full ring-2 ring-transparent hover:ring-gray-500 focus:outline-none focus:ring-gray-400"
        aria-label="Account"
        aria-expanded={open}
      >
        <Avatar name={user.name ?? user.email} url={user.avatarUrl} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-2 text-sm text-gray-200">
          <div className="px-4 py-2 border-b border-gray-800">
            <div className="font-medium truncate">{user.name ?? user.email}</div>
            <div className="text-gray-400 truncate">{user.email}</div>
            {role && <div className="mt-1 text-xs text-gray-500">{ROLE_LABELS[role]} of this band</div>}
            {!role && guest && <div className="mt-1 text-xs text-gray-500">Guest of this band{until && ` until ${until}`}</div>}
            {!role && !guest && platformAdmin && bandId && (
              <div className="mt-1 text-xs text-blue-300">Site admin: Owner access to this band</div>
            )}
          </div>
          {!role && guest && (
            <button onClick={() => leaveGuest()} className="w-full text-left px-4 py-2 hover:bg-gray-800">
              Leave guest access
            </button>
          )}
          {bandId && role && role !== 'owner' && !confirming && (
            <button onClick={() => setConfirming(true)} className="w-full text-left px-4 py-2 hover:bg-gray-800">
              Leave this band
            </button>
          )}
          {bandId && confirming && (
            <div className="px-4 py-2 border-y border-gray-800">
              <p className="text-gray-300">Leave {bandName}? You’ll need a new invite to rejoin.</p>
              {confirmError && <p className="mt-1 text-red-300">{confirmError}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => leaveBand(bandId).catch((err: Error) => setConfirmError(err.message))}
                  className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white"
                >
                  Leave
                </button>
                <button onClick={() => { setConfirming(false); setConfirmError(null); }} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {platformAdmin && (
            <a href="/admin" className="block w-full text-left px-4 py-2 hover:bg-gray-800">
              Site admin
            </a>
          )}
          <Link to="/account" onClick={() => setOpen(false)} className="block w-full text-left px-4 py-2 hover:bg-gray-800">
            Account settings
          </Link>
          <button onClick={() => signOut()} className="w-full text-left px-4 py-2 hover:bg-gray-800">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (url && !broken) {
    // Google avatars refuse hotlinks that send a referrer.
    return <img src={url} alt="" style={style} className="rounded-full" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span style={style} className="rounded-full bg-gray-600 text-white flex items-center justify-center text-sm font-semibold">
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}
