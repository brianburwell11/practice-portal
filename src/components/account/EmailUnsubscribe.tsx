import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { LegalLinks } from '../legal/LegalPage';

/**
 * `/email/unsubscribe?token=…`, from "Don't email me again" in an invite
 * email. Opening the page changes nothing (mail scanners open links); the
 * button does.
 */
export function EmailUnsubscribe() {
  usePageTitle('Email preferences · Practice Portal');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<{ email: string; blocked: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const api = async (method: 'GET' | 'POST') => {
    const res = await fetch(`/api/email/block?token=${encodeURIComponent(token)}`, { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'This link isn’t valid');
    return data as { email: string; blocked: boolean };
  };

  useEffect(() => {
    api('GET').then(setState).catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const block = async () => {
    setSaving(true);
    try {
      setState(await api('POST'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-page text-gray-100 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-gray-800/60 border border-gray-700 rounded-xl p-6 space-y-5 text-center">
        <h1 className="text-xl font-semibold">Email preferences</h1>
        {!state && !error && <p className="text-gray-400">Loading…</p>}
        {state && (state.blocked ? (
          <p className="text-sm text-gray-300">
            Done. Practice Portal won’t email <span className="text-white">{state.email}</span> again.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-300">
              Stop all emails from Practice Portal to <span className="text-white">{state.email}</span>, including band invites?
            </p>
            <button
              onClick={block}
              disabled={saving}
              className="w-full px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-medium text-white"
            >
              {saving ? 'Saving…' : 'Don’t email me again'}
            </button>
          </>
        ))}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Link to="/" className="inline-block text-xs text-gray-500 hover:text-gray-300">Go to Practice Portal</Link>
        <LegalLinks />
      </div>
    </div>
  );
}
