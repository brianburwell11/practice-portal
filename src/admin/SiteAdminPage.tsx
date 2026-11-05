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

interface ServiceCost {
  key: string;
  label: string;
  usage: number;
  unit: string;
  freeLimit: number | null;
  listUsd: number;
  billedUsd: number;
}

interface BandCost {
  bandId: string;
  weight: number;
  directListUsd: number;
  sharedListUsd: number;
  listUsd: number;
  billedUsd: number;
}

interface Costs {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  machineSeconds: number | null;
  services: ServiceCost[];
  listUsd: number;
  billedUsd: number;
  bands: BandCost[];
}

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

function formatUsage(n: number, unit: string): string {
  const digits = n === 0 || n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
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
  const [costs, setCosts] = useState<Costs | null>(null);

  // Costs use the bands' storage, which the server keeps for a minute: asked
  // after the bands, so measuring again happens once.
  const loadBands = useCallback((fresh = false) => {
    return getJson<{ bands: AdminBand[] }>(`/api/admin/bands${fresh ? '?fresh=1' : ''}`)
      .then((d) => setBands(d.bands))
      .then(() => getJson<Costs>('/api/admin/costs'))
      .then(setCosts)
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
        <CostsSection costs={costs} />
        <BandsSection
          bands={bands}
          costs={costs}
          measuring={measuring}
          onRefresh={() => { setMeasuring(true); loadBands(true); }}
        />
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

function CostsSection({ costs }: { costs: Costs | null }) {
  const month = costs
    ? new Date(`${costs.month}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-100">Costs {costs && <span className="text-gray-500 font-normal">({month})</span>}</h2>
      {!costs ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
            <Stat label="Estimated bill" value={usd.format(costs.billedUsd)} />
            <Stat label="At list price" value={usd.format(costs.listUsd)} />
            <Stat
              label="Machine uptime"
              value={costs.machineSeconds === null ? 'Not yet' : `${Math.round(costs.machineSeconds / 3600)} h`}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-left text-gray-300">
                <tr>
                  {['Service', 'Projected use', 'Free allowance', 'List price', 'Estimated bill'].map((h, i) => (
                    <th key={h} scope="col" className={`px-3 py-2 font-semibold whitespace-nowrap ${i >= 3 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costs.services.map((s) => {
                  const used = s.freeLimit ? Math.min(1, s.usage / s.freeLimit) : null;
                  return (
                    <tr key={s.key} className="border-t border-gray-800">
                      <td className="px-3 py-2 text-gray-100 whitespace-nowrap">{s.label}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatUsage(s.usage, s.unit)}</td>
                      <td className="px-3 py-2">
                        {used === null ? (
                          <span className="text-gray-600">None</span>
                        ) : (
                          <div className="flex items-center gap-2 min-w-[9rem]">
                            <div className="h-1.5 w-20 rounded bg-gray-800" role="img" aria-label={`${Math.round(used * 100)}% of the free allowance`}>
                              <div
                                className={`h-full rounded ${used >= 0.9 ? 'bg-red-500' : used >= 0.7 ? 'bg-amber-400' : 'bg-blue-500'}`}
                                style={{ width: `${Math.max(used * 100, used > 0 ? 2 : 0)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 whitespace-nowrap">{formatUsage(s.freeLimit!, s.unit)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{usd.format(s.listUsd)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-100">{usd.format(s.billedUsd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            Projected from the first {Math.floor(costs.daysElapsed)} of {costs.daysInMonth} days of the month (UTC). List
            price is what the same use would cost on a paid plan with no free allowance. R2 operations, bandwidth and the
            stopped machine’s disk aren’t counted.
            {costs.machineSeconds === null && ' Machine uptime is recorded from the next deploy on, so the machine shows nothing until then.'}
          </p>
        </>
      )}
    </section>
  );
}

function BandsSection({ bands, costs, measuring, onRefresh }: {
  bands: AdminBand[] | null;
  costs: Costs | null;
  measuring: boolean;
  onRefresh: () => void;
}) {
  const costOf = useMemo(() => new Map((costs?.bands ?? []).map((c) => [c.bandId, c])), [costs]);
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
                  {['Band', 'Owner', 'Visibility', 'Songs', 'Setlists', 'People', 'Storage', 'Cost/mo', 'Created', ''].map((h, i) => (
                    <th key={h || 'go'} scope="col" className={`px-3 py-2 font-semibold whitespace-nowrap ${i >= 3 && i <= 7 ? 'text-right' : ''}`}>{h}</th>
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
                    <BandCostCell cost={costOf.get(b.id)} />
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
          <p className="text-xs text-gray-500">
            Cost/mo is the band’s share of the estimated bill: what it uses on its own (storage, emails, transcoding) plus
            a share of the rest, weighted by its songs, people and storage. Hover for list prices.
          </p>
          <p className="text-xs text-gray-500">Storage counts everything in the band’s folder: audio, sheet music, logo and backups of its data. It’s measured each time this page loads.</p>
        </>
      )}
    </section>
  );
}

function BandCostCell({ cost }: { cost: BandCost | undefined }) {
  if (!cost) return <td className="px-3 py-2 text-right text-gray-600">?</td>;
  const title = [
    `List price ${usd.format(cost.listUsd)}:`,
    `${usd.format(cost.directListUsd)} its own use,`,
    `${usd.format(cost.sharedListUsd)} share of the rest (${Math.round(cost.weight * 100)}%)`,
  ].join(' ');
  return <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" title={title}>{usd.format(cost.billedUsd)}</td>;
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
