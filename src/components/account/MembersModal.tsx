import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, useSessionStore, type BandRole } from '../../store/sessionStore';
import { Avatar } from './AccountMenu';

interface Member {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: BandRole;
  joinedAt: string | null;
}

interface PendingInvite {
  id: string;
  email: string | null;
  role: BandRole;
  expiresAt: string;
}

/** Someone signed in asking to join. */
interface AccessRequest {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  message: string | null;
  createdAt: string;
}

/** The band's "anyone with the link" guest link, as the server reports it. */
interface GuestLink {
  url: string;
  /** Null: never expires. */
  expiresAt: string | null;
  expired: boolean;
  lastUsedAt: string | null;
}

/** `YYYY-MM-DD` in local time, for a date input. */
function toDateInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Roster {
  band: { visibility: 'public' | 'private' };
  you: { userId: string; role: BandRole };
  members: Member[];
  invites: PendingInvite[];
}

interface Props {
  bandId: string;
  bandName: string;
  onClose: () => void;
}

/** Roles you may hand out: your own rank or below, never Owner. */
const GRANTABLE: Record<BandRole, BandRole[]> = {
  owner: ['manager', 'editor', 'member'],
  manager: ['manager', 'editor', 'member'],
  editor: [],
  member: [],
};

const ROLE_HINTS: Record<BandRole, string> = {
  owner: 'Everything, including visibility and transferring the band',
  manager: 'Edit everything and manage members',
  editor: 'Add and edit songs, but not delete songs or change timing',
  member: 'View and play',
};

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function MembersModal({ bandId, bandName, onClose }: Props) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [inviteRole, setInviteRole] = useState<BandRole>('member');
  const [inviteEmail, setInviteEmail] = useState('');
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  /** Undefined while loading; null when the link is off. */
  const [guestLink, setGuestLink] = useState<GuestLink | null | undefined>(undefined);
  const [guestCopied, setGuestCopied] = useState(false);

  const base = `/api/bands/${encodeURIComponent(bandId)}`;

  const refresh = useCallback(async () => {
    try {
      const [members, guest, pending] = await Promise.all([
        api('GET', `${base}/members`), api('GET', `${base}/guest-link`), api('GET', `${base}/access-requests`),
      ]);
      setRoster(members);
      setGuestLink(guest.link);
      setRequests(pending.requests);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [base]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const you = roster?.you;
  const grantable = you ? GRANTABLE[you.role] : [];
  const isOwner = you?.role === 'owner';
  const visibility = roster?.band.visibility;

  const createInvite = () => run(async () => {
    const res = await api('POST', `${base}/invites`, { role: inviteRole, email: inviteEmail.trim() || undefined });
    setNewLink(res.url);
    setCopied(false);
    setInviteEmail('');
  });

  const copyLink = async () => {
    if (!newLink) return;
    await navigator.clipboard.writeText(newLink);
    setCopied(true);
  };

  const copyGuestLink = async () => {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink.url);
    setGuestCopied(true);
  };

  /** `date` is a date input's value; empty means never expire. The link lasts through that day. */
  const setGuestExpiry = (date: string) => run(async () => {
    const expiresAt = date ? new Date(`${date}T23:59:59`).toISOString() : null;
    setGuestLink((await api('PUT', `${base}/guest-link`, { expiresAt })).link);
  });

  const changeVisibility = (v: 'public' | 'private') => run(() => api('PUT', `${base}/visibility`, { visibility: v }));

  const transfer = (m: Member) => {
    const label = m.name ?? m.email;
    if (!window.confirm(`Make ${label} the Owner of ${bandName}? You'll become a Manager, and only ${label} will be able to undo this.`)) return;
    run(async () => {
      await api('POST', `${base}/transfer`, { userId: m.userId });
      await useSessionStore.getState().load();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto p-6 space-y-6 text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Members &amp; sharing — {bandName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">✕</button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">{error}</div>
        )}

        {/* --- Access requests */}
        {requests.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">Asking to join</h3>
            <ul className="divide-y divide-gray-800">
              {requests.map((r) => (
                <li key={r.id} className="py-2 space-y-1">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name ?? r.email} url={r.avatarUrl} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{r.name ?? r.email}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {r.name && `${r.email} · `}{new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/approve`))}
                      disabled={busy}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium text-white"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/decline`))}
                      disabled={busy}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Decline
                    </button>
                  </div>
                  {r.message && <p className="text-sm text-gray-300 whitespace-pre-wrap pl-10">{r.message}</p>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">Approving adds them as a Member. They get an email either way.</p>
          </section>
        )}

        {/* --- Invite */}
        {grantable.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Invite someone</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as BandRole)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
              >
                {grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Their Google email (optional)"
                className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={createInvite}
                disabled={busy}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium text-white"
              >
                Create link
              </button>
            </div>
            <p className="text-xs text-gray-500">
              {ROLE_HINTS[inviteRole]}. The link works once and expires in 7 days.
              {' '}With an email, only that Google account can use it.
            </p>
            {newLink && (
              <div className="bg-gray-800 border border-gray-700 rounded p-3 space-y-2">
                <div className="text-xs text-gray-400">Send this link yourself — it won’t be shown again:</div>
                <div className="flex gap-2">
                  <input readOnly value={newLink} onFocus={(e) => e.target.select()} className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs font-mono" />
                  <button onClick={copyLink} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- Roster */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Members</h3>
          {!roster ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {roster.members.map((m) => {
                const editable = m.role !== 'owner' && grantable.length > 0 && m.userId !== you?.userId
                  && grantable.includes(m.role);
                return (
                  <li key={m.userId} className="flex items-center gap-3 py-2">
                    <Avatar name={m.name ?? m.email} url={m.avatarUrl} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {m.name ?? m.email}{m.userId === you?.userId && <span className="text-gray-500"> (you)</span>}
                      </div>
                      {m.name && <div className="text-xs text-gray-500 truncate">{m.email}</div>}
                    </div>
                    {editable ? (
                      <select
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => run(() => api('PUT', `${base}/members/${m.userId}`, { role: e.target.value }))}
                        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                      >
                        {grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-400">{ROLE_LABELS[m.role]}</span>
                    )}
                    {isOwner && m.role !== 'owner' && (
                      <button onClick={() => transfer(m)} disabled={busy} className="text-xs text-gray-400 hover:text-white" title="Make Owner">
                        Make owner
                      </button>
                    )}
                    {editable && (
                      <button
                        onClick={() => window.confirm(`Remove ${m.name ?? m.email} from ${bandName}?`)
                          && run(() => api('DELETE', `${base}/members/${m.userId}`))}
                        disabled={busy}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* --- Pending invites */}
        {roster && roster.invites.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">Pending invites</h3>
            <ul className="divide-y divide-gray-800">
              {roster.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">
                    {ROLE_LABELS[i.role]} · {i.email ?? 'anyone with the link'}
                    <span className="text-xs text-gray-500"> · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                  </span>
                  <button
                    onClick={() => run(() => api('DELETE', `${base}/invites/${i.id}`))}
                    disabled={busy}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- Guest link (Owner and Manager) */}
        {grantable.length > 0 && guestLink !== undefined && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Guest link</h3>
            <p className="text-xs text-gray-500">
              Anyone with the link can play this band’s songs and setlists — read-only, no account needed. Good for
              subs. Reset it to cut off everyone who has the current one.
              {visibility === 'public' && ' This band is Public, so the link only matters if you make it Members only.'}
            </p>
            {guestLink === null ? (
              <button
                onClick={() => run(async () => setGuestLink((await api('POST', `${base}/guest-link`, {})).link))}
                disabled={busy}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium text-white"
              >
                Turn on guest link
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input readOnly value={guestLink.url} onFocus={(e) => e.target.select()} className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs font-mono" />
                  <button onClick={copyGuestLink} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">
                    {guestCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {guestLink.expired && (
                  <p className="text-xs text-amber-400/90">
                    This link expired on {new Date(guestLink.expiresAt!).toLocaleDateString()}. Change or clear the
                    expiry to bring it back, or reset it.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <label htmlFor="guest-expiry">Expires</label>
                  <input
                    id="guest-expiry"
                    type="date"
                    value={guestLink.expiresAt ? toDateInput(guestLink.expiresAt) : ''}
                    min={toDateInput(new Date().toISOString())}
                    disabled={busy}
                    onChange={(e) => setGuestExpiry(e.target.value)}
                    className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                  />
                  {guestLink.expiresAt ? (
                    <button onClick={() => setGuestExpiry('')} disabled={busy} className="text-gray-400 hover:text-white">
                      Never expire
                    </button>
                  ) : (
                    <span>never</span>
                  )}
                  <span className="ml-auto">
                    {guestLink.lastUsedAt ? `Last opened ${new Date(guestLink.lastUsedAt).toLocaleString()}` : 'Not opened yet'}
                  </span>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => window.confirm('Reset the guest link? Everyone with the current link loses access, and you’ll need to send the new one.')
                      && run(async () => {
                        setGuestLink((await api('POST', `${base}/guest-link`, { expiresAt: guestLink.expired ? null : guestLink.expiresAt })).link);
                        setGuestCopied(false);
                      })}
                    disabled={busy}
                    className="text-xs text-gray-300 hover:text-white"
                  >
                    Reset link
                  </button>
                  <button
                    onClick={() => window.confirm('Turn off the guest link? Everyone using it loses access.')
                      && run(async () => {
                        await api('DELETE', `${base}/guest-link`);
                        setGuestLink(null);
                      })}
                    disabled={busy}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Turn off
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- Visibility (Owner only) */}
        {isOwner && visibility && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">Who can see this band</h3>
            {(['public', 'private'] as const).map((v) => (
              <label key={v} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === v}
                  disabled={busy}
                  onChange={() => changeVisibility(v)}
                  className="mt-1"
                />
                <span>
                  {v === 'public' ? 'Public — anyone with the link' : 'Members only — signed-in members of this band'}
                </span>
              </label>
            ))}
            <p className="text-xs text-amber-400/90">
              Members only hides the band in this app. Its audio and sheet-music files can still be opened by
              anyone who has their direct links, and the band still appears on the older GitHub Pages copy of
              the site, until private media ships.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
