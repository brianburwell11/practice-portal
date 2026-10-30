import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';
import { ROLE_LABELS, useSessionStore } from '../../store/sessionStore';
import { LegalLinks } from '../legal/LegalPage';
import { Avatar } from './AccountMenu';
import { DeleteAccountModal } from './DeleteAccountModal';

/** /account: who you're signed in as, your bands, your data, and deleting the account. */
export function AccountPage() {
  usePageTitle('Account · Practice Portal');
  const { user, bands } = useSessionStore();
  const [deleting, setDeleting] = useState(false);
  // RequireCan has already made sure someone is signed in.
  if (!user) return null;
  const owned = bands.filter((b) => b.role === 'owner');

  return (
    <div className="min-h-screen bg-page text-gray-300">
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
        <header className="space-y-2">
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-300">← Practice Portal</Link>
          <h1 className="text-3xl font-bold text-gray-100">Account</h1>
        </header>

        <section className="flex items-center gap-4">
          <Avatar name={user.name ?? user.email} url={user.avatarUrl} size={56} />
          <div className="min-w-0">
            <div className="text-lg font-medium text-gray-100 truncate">{user.name ?? user.email}</div>
            <div className="text-sm text-gray-400 truncate">{user.email}</div>
            <div className="text-xs text-gray-500 mt-1">Your name, email and picture come from your Google account.</div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-100">Your bands</h2>
          {bands.length === 0 ? (
            <p className="text-sm text-gray-400">You’re not in any bands yet.</p>
          ) : (
            <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
              {bands.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link to={`/${b.slug}`} className="text-gray-100 hover:text-white">{b.name}</Link>
                  <span className="text-gray-500">{ROLE_LABELS[b.role]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-100">Your data</h2>
          <p className="text-sm text-gray-400">
            A file with your account details, the bands you’re in, the notes you’ve written, your saved song settings and
            your requests to join bands.
          </p>
          <a
            href="/api/me/export"
            download
            className="inline-block px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium text-gray-100"
          >
            Download my data
          </a>
        </section>

        <section className="space-y-3 rounded-lg border border-red-900/60 p-4">
          <h2 className="text-lg font-semibold text-red-400">Delete account</h2>
          {owned.length > 0 ? (
            <p className="text-sm text-gray-400">
              You own {owned.map((b) => b.name).join(', ')}. Before you can delete your account, hand{' '}
              {owned.length > 1 ? 'each band' : 'it'} to another member in Members &amp; Sharing, or delete{' '}
              {owned.length > 1 ? 'them' : 'it'}.
            </p>
          ) : (
            <p className="text-sm text-gray-400">
              Removes your account and takes you out of every band. This can’t be undone.
            </p>
          )}
          <button
            onClick={() => setDeleting(true)}
            disabled={owned.length > 0}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium text-white"
          >
            Delete account
          </button>
        </section>

        <LegalLinks />
      </div>
      {deleting && <DeleteAccountModal onClose={() => setDeleting(false)} />}
    </div>
  );
}
