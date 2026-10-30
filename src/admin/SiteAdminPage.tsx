import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLES } from '../config/capabilities';
import { NotFound } from '../components/NotFound';
import { Avatar } from '../components/account/AccountMenu';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSessionStore } from '../store/sessionStore';
import { toast } from '../store/dialogStore';
import practicePortalMark from '../assets/practice-portal-mark-large.png';

interface AdminBand {
  id: string;
  slug: string;
  name: string;
  visibility: 'public' | 'private';
  createdAt: string;
  owner: { name: string | null; email: string };
  songs: number;
  setlists: number;
  people: number;
  storageBytes: number | null;
  storageFiles: number | null;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  siteAdmin: boolean;
  bands: { slug: string; name: string; role: string }[];
}

const roleLabel = (key: string) => ROLES.find((r) => r.key === key)?.label ?? key;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '?';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 days ago", with the exact time on hover. */
function When({ at }: { at: string | null }) {
  // The page's "now", read once: times don't tick while you look.
  const [now] = useState(() => Date.now());
  if (!at) return <span className="text-gray-600">Never</span>;
  const ms = new Date(at).getTime() - now;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]];
  const [unit, size] = steps.find(([, s]) => Math.abs(ms) >= s) ?? ['minute', 6e4];
  return <span title={new Date(at).toLocaleString()}>{relative.format(Math.round(ms / size), unit)}</span>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * `/admin`: the site admin dashboard. Anyone who isn't in ADMIN_EMAILS gets
 * the ordinary 404, so the page doesn't advertise itself. The server checks
 * too: its data routes answer site admins only.
 */
export default function SiteAdminPage() {
  const { loaded, platformAdmin, load } = useSessionStore();
  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return <div className="min-h-screen bg-page" />;
  if (!platformAdmin) return <NotFound />;
  return <Dashboard />;
}

function Dashboard() {
  usePageTitle('Site admin · Practice Portal');
  const [bands, setBands] = useState<AdminBand[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [deletedCount, setDeletedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(true);

  const loadBands = useCallback(() => {
    return getJson<{ bands: AdminBand[] }>('/api/admin/bands')
      .then((d) => setBands(d.bands))
      .catch((err) => setError(err.message))
      .finally(() => setMeasuring(false));
  }, []);

  useEffect(() => {
    loadBands();
    getJson<{ users: AdminUser[]; deletedCount: number }>('/api/admin/users')
      .then((d) => {
        setUsers(d.users);
        setDeletedCount(d.deletedCount);
      })
      .catch((err) => setError(err.message));
  }, [loadBands]);

  return (
    <div className="min-h-screen bg-page text-gray-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <header className="space-y-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300">
            <img src={practicePortalMark} alt="" className="h-5 w-auto" />
            Practice Portal
          </Link>
          <h1 className="text-3xl font-bold text-gray-100">Site admin</h1>
        </header>
        {error && <p className="rounded border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        <BandsSection bands={bands} measuring={measuring} onRefresh={() => { setMeasuring(true); loadBands(); }} />
        <UsersSection users={users} deletedCount={deletedCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-white/[0.03] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-100">{value}</div>
    </div>
  );
}

function BandsSection({ bands, measuring, onRefresh }: { bands: AdminBand[] | null; measuring: boolean; onRefresh: () => void }) {
  const sorted = useMemo(() => [...(bands ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [bands]);
  const total = (k: 'songs' | 'storageBytes') => sorted.reduce((sum, b) => sum + (b[k] ?? 0), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-100">Bands</h2>
        <button
          onClick={onRefresh}
          disabled={measuring}
          className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-sm text-gray-100"
        >
          {measuring ? 'Measuring…' : 'Measure storage again'}
        </button>
      </div>
      {!bands ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            <Stat label="Bands" value={sorted.length} />
            <Stat label="Songs" value={total('songs')} />
            <Stat label="Storage" value={sorted.some((b) => b.storageBytes !== null) ? formatBytes(total('storageBytes')) : '?'} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-gray-300">
                <tr>
                  {['Band', 'Owner', 'Visibility', 'Songs', 'Setlists', 'People', 'Storage', 'Created', ''].map((h, i) => (
                    <th key={h || 'go'} scope="col" className={`px-3 py-2 font-semibold whitespace-nowrap ${i >= 3 && i <= 6 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.id} className="border-t border-gray-800">
                    <td className="px-3 py-2">
                      <Link to={`/${b.slug}`} className="font-medium text-gray-100 hover:text-blue-300">{b.name}</Link>
                      <div className="text-xs text-gray-500 font-mono">/{b.slug}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-200">{b.owner.name ?? '–'}</div>
                      <div className="text-xs text-gray-500">{b.owner.email}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{b.visibility === 'public' ? 'Public' : 'Members only'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.songs}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.setlists}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.people}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={b.storageFiles !== null ? `${b.storageFiles} files` : 'Couldn’t measure'}>
                      {formatBytes(b.storageBytes)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap"><When at={b.createdAt} /></td>
                    <td className="px-3 py-2 text-right">
                      {/* A full load, so the band opens with the Owner's controls (support access). */}
                      <a
                        href={`/${b.slug}`}
                        title={`Go to ${b.name} with the Owner’s access`}
                        aria-label={`Go to ${b.name}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:bg-gray-800 hover:text-white"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            The arrow opens a band with the Owner’s access. You won’t appear in its
            members, and what you change there is logged as support.
          </p>
          <p className="text-xs text-gray-500">Storage counts everything in the band’s folder: audio, sheet music, logo and backups of its data. It’s measured each time this page loads.</p>
        </>
      )}
    </section>
  );
}

function UsersSection({ users, deletedCount }: { users: AdminUser[] | null; deletedCount: number }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(users ?? [])]
      .filter((u) => !q || `${u.name ?? ''} ${u.email} ${u.bands.map((b) => b.name).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.email.localeCompare(b.email));
  }, [users, query]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-100">
          Users {users && <span className="text-gray-500 font-normal">({users.length})</span>}
          {deletedCount > 0 && (
            <span className="ml-2 text-sm text-gray-500 font-normal">
              plus {deletedCount} deleted {deletedCount === 1 ? 'account' : 'accounts'}
            </span>
          )}
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or band"
          className="w-full sm:w-72 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        />
      </div>
      {!users ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-left text-gray-300">
              <tr>
                {['User', 'Bands and roles', 'Last seen', 'Last sign-in', 'Joined'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <UserRow key={u.id} user={u} open={open === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} />
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="px-3 py-4 text-gray-500">No one matches.</p>}
        </div>
      )}
      <p className="text-xs text-gray-500">Last seen updates at most once an hour. Click a user to email them.</p>
    </section>
  );
}

function UserRow({ user: u, open, onToggle }: { user: AdminUser; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-gray-800 align-top cursor-pointer hover:bg-white/[0.02]" onClick={onToggle} aria-expanded={open}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <Avatar name={u.name ?? u.email} url={u.avatarUrl} size={28} />
            <div className="min-w-0">
              <div className="text-gray-100">
                {u.name ?? '–'}
                {u.siteAdmin && <span className="ml-2 rounded bg-blue-600/30 px-1.5 py-px text-[10px] uppercase tracking-wide text-blue-200">Site admin</span>}
              </div>
              <div className="text-xs text-gray-500">{u.email}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2">
          {u.bands.length === 0 ? (
            <span className="text-gray-600">No bands</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {u.bands.map((b) => (
                <span key={b.slug} className="rounded-full border border-gray-700 px-2 py-0.5 text-xs whitespace-nowrap">
                  {b.name} <span className="text-gray-500">· {roleLabel(b.role)}</span>
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2 whitespace-nowrap"><When at={u.lastSeenAt} /></td>
        <td className="px-3 py-2 whitespace-nowrap"><When at={u.lastSignInAt} /></td>
        <td className="px-3 py-2 whitespace-nowrap"><When at={u.createdAt} /></td>
      </tr>
      {open && (
        <tr className="bg-white/[0.02]">
          <td colSpan={5} className="px-3 pb-4 pt-1">
            <EmailUser user={u} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Email one user, as you: from our address with your name, and replies come to you. */
function EmailUser({ user }: { user: AdminUser }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = useSessionStore((s) => s.user);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Couldn’t send the email');
      toast(data.sent ? `Email sent to ${user.email}.` : `Not sent: email isn’t set up on this server.`, data.sent ? 'info' : 'error');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 p-3 space-y-2 max-w-2xl">
      <div className="text-sm font-medium text-gray-100">Email {user.name ?? user.email}</div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={150}
        placeholder="Subject"
        aria-label="Subject"
        className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={5000}
        rows={5}
        placeholder="Message"
        aria-label="Message"
        className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={sending || !subject.trim() || !message.trim()}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-white"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        <span className="text-xs text-gray-500">
          From Practice Portal (admin@practiceportal.app). Replies go to {me?.email}.
        </span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
