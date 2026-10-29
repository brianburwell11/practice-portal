import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, useSessionStore, type BandRole } from '../../store/sessionStore';
import { Avatar } from './AccountMenu';
import { Modal } from '../ui/Modal';
import { confirmDialog, toast } from '../../store/dialogStore';

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

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
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
  /** Who the last invite was emailed to, if it was. */
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
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

  /** Do something, then reload the roster. `done` is toasted when it works. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      if (done) toast(done);
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
    setEmailedTo(res.emailed ? res.email : null);
    setCopied(false);
    setInviteEmail('');
  });

  const copyLink = async () => {
    if (!newLink) return;
    await navigator.clipboard.writeText(newLink);
    setCopied(true);
    toast('Invite link copied.');
    setTimeout(() => setCopied(false), 2000);
  };

  const copyGuestLink = async () => {
    if (!guestLink) return;
    await navigator.clipboard.writeText(guestLink.url);
    setGuestCopied(true);
    toast('Guest link copied.');
  };

  /** `date` is a date input's value; empty means never expire. The link lasts through that day. */
  const setGuestExpiry = (date: string) => run(async () => {
    const expiresAt = date ? new Date(`${date}T23:59:59`).toISOString() : null;
    setGuestLink((await api('PUT', `${base}/guest-link`, { expiresAt })).link);
  });

  const changeVisibility = async (v: 'public' | 'private') => {
    const ok = await confirmDialog(v === 'public'
      ? {
        title: `Make ${bandName} Public?`,
        message: 'Anyone with the link will be able to see the band and play its songs, without signing in.',
        confirmLabel: 'Make Public',
      }
      : {
        title: `Make ${bandName} Members only?`,
        message: 'Only signed-in members of the band, and anyone with its guest link, will be able to see it.',
        confirmLabel: 'Make Members only',
      });
    if (ok) run(() => api('PUT', `${base}/visibility`, { visibility: v }), v === 'public' ? `${bandName} is now Public.` : `${bandName} is now Members only.`);
  };

  const transfer = async (m: Member) => {
    const label = m.name ?? m.email;
    if (!(await confirmDialog({
      title: `Make ${label} the Owner?`,
      message: `You’ll become a Manager of ${bandName}, and only ${label} will be able to undo this.`,
      confirmLabel: 'Transfer ownership',
      danger: true,
    }))) return;
    run(async () => {
      await api('POST', `${base}/transfer`, { userId: m.userId });
      await useSessionStore.getState().load();
    });
  };

  return (
    <Modal
      onClose={onClose}
      title={<>Members &amp; sharing <span className="font-normal text-gray-400">{bandName}</span></>}
      showClose
      className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto scrollbar-none p-6 space-y-6 text-gray-200"
    >

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
                    onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/approve`), `${r.name ?? r.email} is in the band.`)}
                    disabled={busy}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-medium text-white"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/decline`), 'Request declined.')}
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
              Send invite
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {ROLE_HINTS[inviteRole]}. The link works once and expires in 7 days.
          </p>
          {newLink && (
            <div className="space-y-1">
              <div className="text-xs text-gray-400">
                {emailedTo ? `Emailed to ${emailedTo}. The link, in case it doesn’t arrive:` : 'Send this link yourself:'}
              </div>
              <div className="group flex items-center gap-2 bg-gray-800 border border-gray-700 rounded px-3 py-2">
                <span className="flex-1 min-w-0 truncate font-mono text-xs text-gray-200 select-all" title={newLink}>{newLink}</span>
                {/* Shown on hover (always on touch screens, which can't hover). */}
                <button
                  onClick={copyLink}
                  aria-label={copied ? 'Copied' : 'Copy link'}
                  title={copied ? 'Copied' : 'Copy link'}
                  className={`shrink-0 focus-visible:opacity-100 transition-opacity ${copied ? 'text-green-400' : 'text-gray-400 hover:text-white pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100'}`}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
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
                      onChange={(e) => {
                        const role = e.target.value as BandRole;
                        run(() => api('PUT', `${base}/members/${m.userId}`, { role }), `${m.name ?? m.email} is now ${/^[AEIOU]/.test(ROLE_LABELS[role]) ? 'an' : 'a'} ${ROLE_LABELS[role]}.`);
                      }}
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
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: `Remove ${m.name ?? m.email}?`,
                          message: `They’ll lose access to ${bandName}.`,
                          confirmLabel: 'Remove',
                          danger: true,
                        });
                        if (ok) run(() => api('DELETE', `${base}/members/${m.userId}`), `${m.name ?? m.email} was removed.`);
                      }}
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
                  onClick={async () => (await confirmDialog({
                    title: 'Reset the guest link?',
                    message: 'Everyone with the current link loses access, and you’ll need to send the new one.',
                    confirmLabel: 'Reset link',
                    danger: true,
                  })) && run(async () => {
                      setGuestLink((await api('POST', `${base}/guest-link`, { expiresAt: guestLink.expired ? null : guestLink.expiresAt })).link);
                      setGuestCopied(false);
                    })}
                  disabled={busy}
                  className="text-xs text-gray-300 hover:text-white"
                >
                  Reset link
                </button>
                <button
                  onClick={async () => (await confirmDialog({
                    title: 'Turn off the guest link?',
                    message: 'Everyone using it loses access.',
                    confirmLabel: 'Turn off',
                    danger: true,
                  })) && run(async () => {
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
                {v === 'public' ? 'Public: anyone with the link' : 'Members only: signed-in members of this band'}
              </span>
            </label>
          ))}
        </section>
      )}
    </Modal>
  );
}
