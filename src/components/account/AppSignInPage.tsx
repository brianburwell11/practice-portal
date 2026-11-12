import { useEffect, useState } from 'react';
import { signInHref, useSessionStore } from '../../store/sessionStore';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';

/**
 * `/app-sign-in?id=…` — where the iPhone home screen app sends you, in
 * Safari, to sign in (SignInHandoff.tsx). Google sends you back here signed in; you confirm
 * the code the app is showing, and the app collects its session.
 */
export function AppSignInPage() {
  const { loaded, user, load } = useSessionStore();
  const [id] = useState(() => new URLSearchParams(window.location.search).get('id') ?? '');
  const [signInError] = useState(() => new URLSearchParams(window.location.search).get('signin_error'));
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'confirm' | 'sending' | 'done'>('confirm');

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!id) {
      setError('This sign-in link is incomplete. Start again from the app.');
      return;
    }
    fetch(`/api/auth/handoff/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
        setCode(data.code);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  const approve = async () => {
    setStep('sending');
    try {
      const r = await fetch(`/api/auth/handoff/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
      setStep('confirm');
    }
  };

  const here = `/app-sign-in?id=${encodeURIComponent(id)}`;
  let body;
  if (step === 'done') {
    body = (
      <>
        <h1 className="text-xl font-semibold">You’re signed in</h1>
        <p className="text-gray-300">Now go back to the Practice Portal app on your home screen.</p>
      </>
    );
  } else if (error || signInError) {
    body = (
      <>
        <h1 className="text-xl font-semibold">That didn’t work</h1>
        <p className="text-red-300">{error ?? signInError}</p>
        {!error && id && (
          <a href={signInHref(here)} className="inline-block px-4 py-2 rounded-lg bg-white text-gray-800 font-medium hover:bg-gray-100">
            Try again
          </a>
        )}
      </>
    );
  } else if (!loaded || !code) {
    body = <p className="text-gray-500">Loading...</p>;
  } else if (!user) {
    body = (
      <>
        <h1 className="text-xl font-semibold">Sign in to the app</h1>
        <a href={signInHref(here)} className="inline-block px-4 py-2 rounded-lg bg-white text-gray-800 font-medium hover:bg-gray-100">
          Sign in with Google
        </a>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-xl font-semibold">Sign in to the app?</h1>
        <p className="text-gray-300">
          This signs the Practice Portal app on your home screen in as <b className="text-white">{user.email}</b>.
        </p>
        <p className="font-mono text-4xl tracking-[0.3em] text-white">{code}</p>
        <p className="text-sm text-gray-400">
          Only continue if the app is showing this same code. If you didn’t just tap Sign in there, close this page.
        </p>
        <button
          onClick={approve}
          disabled={step === 'sending'}
          className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-medium text-accent-ink"
        >
          It matches, sign in the app
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-page text-gray-100 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-4">
        <img src={practicePortalMark} alt="" className="h-14 w-auto" />
        {body}
      </div>
    </div>
  );
}
