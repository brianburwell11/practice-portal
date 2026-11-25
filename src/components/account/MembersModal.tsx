import { useCallback, useEffect, useId, useState } from 'react';
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Stands in for an avatar on an invite nobody has used yet. */
function InviteMark({ email }: { email: boolean }) {
  return (
    <span className="shrink-0 w-9 h-9 rounded-full border border-dashed border-gray-600 text-gray-500 flex items-center justify-center">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {email ? (
          <>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 6L2 7" />
          </>
        ) : (
          <>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </>
        )}
      </svg>
    </span>
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

/** "an Editor", "a Member". */
const withArticle = (role: BandRole) => `${/^[AEIOU]/.test(ROLE_LABELS[role]) ? 'an' : 'a'} ${ROLE_LABELS[role]}`;

const SECTION = 'py-6 first:pt-0 last:pb-0 space-y-3';
const HEADING = 'text-sm font-semibold text-gray-200';
/** Quiet text buttons, with a finger-sized hit area on phones. */
const TEXT_BTN = 'min-h-10 md:min-h-0 md:py-1 px-1 -mx-1 text-sm md:text-xs disabled:opacity-50';
const PRIMARY_BTN = 'min-h-11 md:min-h-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium text-accent-ink';

/** A row of role choices, with what the picked one can do underneath. */
function RolePicker({ label, value, options, disabled, onChange }: {
  label: string;
  value: BandRole;
  options: BandRole[];
  disabled?: boolean;
  onChange: (role: BandRole) => void;
}) {
  const hintId = useId();
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label={label} aria-describedby={hintId} className="flex rounded-md bg-gray-800 border border-gray-700 p-0.5">
        {options.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            disabled={disabled}
            onClick={() => { if (r !== value) onChange(r); }}
            className={`flex-1 min-h-10 md:min-h-8 rounded text-sm font-medium transition-colors disabled:opacity-50 ${
              value === r ? 'bg-gray-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      <p id={hintId} className="text-xs text-gray-400">{ROLE_HINTS[value]}.</p>
    </div>
  );
}

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
  /** Why the last invite with an address wasn't emailed. */
  const [emailSkipped, setEmailSkipped] = useState<'blocked' | 'weekly-limit' | null>(null);
  const [copied, setCopied] = useState(false);

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  /** Undefined while loading; null when the link is off. */
  const [guestLink, setGuestLink] = useState<GuestLink | null | undefined>(undefined);
  const [guestCopied, setGuestCopied] = useState(false);

  /** The member whose role and actions are open. One at a time. */
  const [openMember, setOpenMember] = useState<string | null>(null);

  const titleId = useId();
  const emailId = useId();
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
    setEmailSkipped(res.emailSkipped ?? null);
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

  const remove = async (m: Member) => {
    const ok = await confirmDialog({
      title: `Remove ${m.name ?? m.email}?`,
      message: `They’ll lose access to ${bandName}.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) {
      setOpenMember(null);
      run(() => api('DELETE', `${base}/members/${m.userId}`), `${m.name ?? m.email} was removed.`);
    }
  };

  const memberCount = roster?.members.length;
  const inviteCount = roster?.invites.length ?? 0;

  return (
    <Modal
      onClose={onClose}
      ariaLabel={`Members and sharing, ${bandName}`}
      // Phones: the whole screen, so every name has room. Wider: a centred panel.
      className="bg-gray-900 md:border border-gray-700 md:rounded-lg shadow-xl w-full md:max-w-lg md:mx-4 h-[100dvh] md:h-auto md:max-h-[90vh] flex flex-col text-gray-200"
    >
      <header className="shrink-0 flex items-start gap-3 px-4 md:px-6 pt-[max(1rem,env(safe-area-inset-top))] md:pt-5 pb-3 border-b border-gray-800">
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-gray-100 leading-tight">Members &amp; sharing</h2>
          <p className="text-sm text-gray-400 break-words">{bandName}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 w-10 h-10 shrink-0 flex items-center justify-center rounded text-2xl leading-none text-gray-400 hover:text-gray-200 hover:bg-gray-800"
        >
          &times;
        </button>
      </header>

      {error && (
        <div role="alert" className="shrink-0 mx-4 md:mx-6 mt-3 bg-red-900/30 border border-red-700 rounded p-3 text-sm text-red-300">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-none px-4 md:px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-6 divide-y divide-gray-800">

        {/* --- Access requests: first, since someone is waiting on an answer */}
        {requests.length > 0 && (
          <section className={SECTION} aria-labelledby={`${titleId}-requests`}>
            <h3 id={`${titleId}-requests`} className={HEADING}>
              Asking to join <span className="font-normal text-gray-500">{requests.length}</span>
            </h3>
            <ul className="space-y-3">
              {requests.map((r) => (
                <li key={r.id} className="rounded-lg bg-gray-800/60 border border-gray-700/70 p-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <Avatar name={r.name ?? r.email} url={r.avatarUrl} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] md:text-sm font-medium text-gray-100 break-words">{r.name ?? r.email}</div>
                      <div className="text-xs text-gray-400 break-all">
                        {r.name && `${r.email} · `}{new Date(r.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  {r.message && <p className="text-sm text-gray-300 whitespace-pre-wrap break-words">{r.message}</p>}
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/approve`), `${r.name ?? r.email} is in the band.`)}
                      disabled={busy}
                      className={`${PRIMARY_BTN} flex-1 md:flex-none`}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => run(() => api('POST', `${base}/access-requests/${r.id}/decline`), 'Request declined.')}
                      disabled={busy}
                      className={`${TEXT_BTN} text-red-400 hover:text-red-300`}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">Approving adds them as a Member. They get an email either way.</p>
          </section>
        )}

        {/* --- Who's in the band, and who's been invited */}
        <section className={SECTION} aria-labelledby={`${titleId}-members`}>
          <h3 id={`${titleId}-members`} className={HEADING}>
            Members {memberCount !== undefined && <span className="font-normal text-gray-500">{memberCount}</span>}
          </h3>
          {!roster ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <ul className="-mx-2">
              {roster.members.map((m) => {
                const isYou = m.userId === you?.userId;
                const editable = m.role !== 'owner' && grantable.length > 0 && !isYou && grantable.includes(m.role);
                const canTransfer = isOwner && m.role !== 'owner';
                const manageable = editable || canTransfer;
                const open = manageable && openMember === m.userId;
                const panelId = `${titleId}-m-${m.userId}`;
                const who = (
                  <>
                    <Avatar name={m.name ?? m.email} url={m.avatarUrl} size={36} />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-[15px] md:text-sm font-medium text-gray-100 break-words">
                        {m.name ?? m.email}
                        {isYou && <span className="font-normal text-gray-500"> (you)</span>}
                      </div>
                      {m.name && <div className="text-xs text-gray-400 truncate">{m.email}</div>}
                    </div>
                    <span className={`shrink-0 text-xs ${m.role === 'owner' ? 'text-gray-200' : 'text-gray-400'}`}>{ROLE_LABELS[m.role]}</span>
                  </>
                );
                return (
                  <li key={m.userId} className={`rounded-lg transition-colors ${open ? 'bg-gray-800/70' : ''}`}>
                    {manageable ? (
                      <button
                        type="button"
                        onClick={() => setOpenMember(open ? null : m.userId)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-gray-800/70 text-gray-400"
                      >
                        {who}
                        <ChevronIcon open={open} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-2 py-2.5">
                        {who}
                        {/* Lines the role up with the rows that have a chevron. */}
                        {grantable.length > 0 && <span className="w-4 shrink-0" aria-hidden="true" />}
                      </div>
                    )}
                    {open && (
                      <div id={panelId} className="px-2 pb-3 pt-1 space-y-3 md:pl-[3.25rem]">
                        {editable && (
                          <RolePicker
                            label={`${m.name ?? m.email}’s role`}
                            value={m.role}
                            options={grantable}
                            disabled={busy}
                            onChange={(role) => run(
                              () => api('PUT', `${base}/members/${m.userId}`, { role }),
                              `${m.name ?? m.email} is now ${withArticle(role)}.`,
                            )}
                          />
                        )}
                        <div className="flex flex-wrap items-center gap-x-5">
                          {canTransfer && (
                            <button onClick={() => transfer(m)} disabled={busy} className={`${TEXT_BTN} text-gray-300 hover:text-white`}>
                              Make owner
                            </button>
                          )}
                          {editable && (
                            <button onClick={() => remove(m)} disabled={busy} className={`${TEXT_BTN} text-red-400 hover:text-red-300`}>
                              Remove from band
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {inviteCount > 0 && (
            <div className="pt-2 space-y-1">
              <h4 className="text-xs font-medium text-gray-400">Invited, not joined yet</h4>
              <ul className="-mx-2">
                {roster!.invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-2 py-2">
                    <InviteMark email={!!i.email} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-300 break-all">{i.email ?? 'Anyone with the link'}</div>
                      <div className="text-xs text-gray-500">
                        {ROLE_LABELS[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                    {grantable.length > 0 && (
                      <button
                        onClick={() => run(() => api('DELETE', `${base}/invites/${i.id}`), 'Invite revoked.')}
                        disabled={busy}
                        className={`${TEXT_BTN} shrink-0 text-red-400 hover:text-red-300`}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* --- Invite: one person, one link, a role */}
        {grantable.length > 0 && (
          <section className={SECTION} aria-labelledby={`${titleId}-invite`}>
            <div className="space-y-1">
              <h3 id={`${titleId}-invite`} className={HEADING}>Invite someone</h3>
              <p className="text-xs text-gray-400">
                They sign in with Google and join with the role you pick. The link works once and expires in 7 days.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={emailId} className="block text-xs font-medium text-gray-400">Their Google email (optional)</label>
              <input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) createInvite(); }}
                placeholder="name@gmail.com"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-base md:text-sm placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500">Leave it blank to get a link to send yourself.</p>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-gray-400" aria-hidden="true">Joins as</div>
              <RolePicker label="Joins as" value={inviteRole} options={grantable} disabled={busy} onChange={setInviteRole} />
              <a href="/help/roles-and-permissions" target="_blank" rel="noopener" className="inline-block text-xs text-blue-400 hover:text-blue-300">
                What can each role do?
              </a>
            </div>
            <button onClick={createInvite} disabled={busy} className={`${PRIMARY_BTN} w-full md:w-auto`}>
              {inviteEmail.trim() ? 'Send invite' : 'Create invite link'}
            </button>
            {newLink && (
              <div className="space-y-1.5 rounded-lg bg-gray-800/60 border border-gray-700/70 p-3">
                <div className="text-xs text-gray-300">
                  {emailedTo
                    ? `Emailed to ${emailedTo}. The link, in case it doesn’t arrive:`
                    : emailSkipped === 'weekly-limit'
                      ? 'This band has sent its 10 invite emails for the week, so this one wasn’t emailed. Send the link yourself:'
                      : emailSkipped === 'blocked'
                        ? 'That address has asked not to get emails from Practice Portal. Send the link yourself:'
                        : 'Send this link yourself:'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate font-mono text-xs text-gray-200 select-all bg-gray-900 border border-gray-700 rounded px-2 py-2" title={newLink}>{newLink}</span>
                  <button
                    onClick={copyLink}
                    className={`shrink-0 min-h-10 md:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm md:text-xs ${copied ? 'text-green-400' : 'text-gray-100'}`}
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* --- Guest link: anyone, no account, play only (Owner and Manager) */}
        {grantable.length > 0 && guestLink !== undefined && (
          <section className={SECTION} aria-labelledby={`${titleId}-guest`}>
            <div className="space-y-1">
              <h3 id={`${titleId}-guest`} className={HEADING}>
                Guest link {guestLink && !guestLink.expired && <span className="font-normal text-green-400/90">On</span>}
              </h3>
              <p className="text-xs text-gray-400">
                Anyone with the link can play this band’s songs and setlists without an account, but can’t change
                anything. Good for subs. Reset it to cut off everyone who has the current one.
                {visibility === 'public' && ' This band is Public, so the link only matters if you make it Members only.'}
              </p>
            </div>
            {guestLink === null ? (
              <button
                onClick={() => run(async () => setGuestLink((await api('POST', `${base}/guest-link`, {})).link))}
                disabled={busy}
                className={`${PRIMARY_BTN} w-full md:w-auto`}
              >
                Turn on guest link
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={guestLink.url}
                    aria-label="Guest link"
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-2 text-xs font-mono"
                  />
                  <button
                    onClick={copyGuestLink}
                    className={`shrink-0 min-h-10 md:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm md:text-xs ${guestCopied ? 'text-green-400' : 'text-gray-100'}`}
                  >
                    {guestCopied ? <CheckIcon /> : <CopyIcon />}
                    {guestCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {guestLink.expired && (
                  <p className="text-xs text-amber-400/90">
                    This link expired on {new Date(guestLink.expiresAt!).toLocaleDateString()}. Change or clear the
                    expiry to bring it back, or reset it.
                  </p>
                )}
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs">
                  <dt className="text-gray-400"><label htmlFor={`${titleId}-expiry`}>Expires</label></dt>
                  <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <input
                      id={`${titleId}-expiry`}
                      type="date"
                      value={guestLink.expiresAt ? toDateInput(guestLink.expiresAt) : ''}
                      min={toDateInput(new Date().toISOString())}
                      disabled={busy}
                      onChange={(e) => setGuestExpiry(e.target.value)}
                      className="min-h-10 md:min-h-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-base md:text-xs text-gray-200"
                    />
                    {guestLink.expiresAt ? (
                      <button onClick={() => setGuestExpiry('')} disabled={busy} className={`${TEXT_BTN} text-gray-300 hover:text-white`}>
                        Never expire
                      </button>
                    ) : (
                      <span className="text-gray-500">Never</span>
                    )}
                  </dd>
                  <dt className="text-gray-400">Last opened</dt>
                  <dd className="text-gray-300">
                    {guestLink.lastUsedAt ? new Date(guestLink.lastUsedAt).toLocaleString() : 'Not yet'}
                  </dd>
                </dl>
                <div className="flex gap-5">
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
                    className={`${TEXT_BTN} text-gray-300 hover:text-white`}
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
                    className={`${TEXT_BTN} text-red-400 hover:text-red-300`}
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
          <section className={SECTION} aria-labelledby={`${titleId}-visibility`}>
            <h3 id={`${titleId}-visibility`} className={HEADING}>Who can see this band</h3>
            <div className="space-y-1">
              {(['public', 'private'] as const).map((v) => (
                <label key={v} className="flex items-start gap-3 py-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    checked={visibility === v}
                    disabled={busy}
                    onChange={() => changeVisibility(v)}
                    className="mt-0.5 w-4 h-4 shrink-0"
                  />
                  <span>
                    <span className="text-gray-100">{v === 'public' ? 'Public' : 'Members only'}</span>
                    <span className="block text-xs text-gray-400">
                      {v === 'public' ? 'Anyone with the link' : 'Signed-in members of this band'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
