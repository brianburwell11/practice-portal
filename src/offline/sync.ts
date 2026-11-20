/**
 * Edits that work with no network: lyrics, chords and timing are saved on
 * this device first (`editStore.ts`), then sent. Whatever couldn't be sent
 * waits and goes on its own when the server can be reached: on the `online`
 * event, at app start, and every 30 s while anything waits.
 *
 * When someone else saved the same document meanwhile (409), the edit is
 * merged (`merge.ts`) and sent again with no prompt where the changes don't
 * overlap; otherwise it waits for a decision ("Keep mine" / "Keep theirs").
 *
 * Edits belong to the account that made them: only that account sees or
 * sends them, and each send names it (`?asUser=`), so the server refuses it
 * under anyone else's session. Someone else's edits on this device are held
 * for them (or discarded, on purpose).
 */
import { toast } from '../store/dialogStore';
import { useSessionStore } from '../store/sessionStore';
import { fetchDoc, knownBase, knownRev, setKnown } from '../utils/docRevs';
import { prefetchedOr } from '../data/prefetch';
import { markOffline, markOnline, noteResponse, useConnectivity } from './connectivity';
import { allEdits, coalesce, deleteEdit, editId, getEdit, putEdit, supported, type PendingEdit } from './editStore';
import { mergeKindOf, resolveConflict } from './merge';

const RETRY_MS = 30_000;
const SEND_TIMEOUT_MS = 15_000;

/** A document's content changed under the app (merged, or "keep theirs"): show the new copy. */
type DocListener = (key: string, data: unknown) => void;
const listeners = new Set<DocListener>();

export function onDocChange(fn: DocListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(key: string, data: unknown) {
  for (const fn of listeners) {
    try { fn(key, data); } catch (err) { console.error('[sync] listener failed', err); }
  }
}

/** Who's signed in (once the session has loaded, from the network or the offline cache). */
async function whoAmI(): Promise<{ id: string | null; name: string }> {
  await useSessionStore.getState().load().catch(() => undefined);
  const user = useSessionStore.getState().user;
  return { id: user?.id ?? null, name: user?.name ?? user?.email ?? 'Someone' };
}

/** Edits this account made (none when nobody's signed in). */
async function myEdits(): Promise<PendingEdit[]> {
  const { id } = await whoAmI();
  if (!id) return [];
  return (await allEdits()).filter((e) => e.userId === id);
}

/** Update the counts the status indicator shows. */
async function refreshCounts(): Promise<void> {
  const { id } = await whoAmI();
  const edits = await allEdits().catch(() => [] as PendingEdit[]);
  const mine = edits.filter((e) => id && e.userId === id);
  const others = edits.filter((e) => !id || e.userId !== id);
  useConnectivity.setState({
    pending: mine.filter((e) => e.state === 'pending').length,
    conflicts: mine.filter((e) => e.state === 'conflict').map((e) => ({ id: e.id, key: e.key, label: e.label })),
    held: others.length,
    heldFor: [...new Set(others.map((e) => e.userName))],
  });
}

export type SaveOutcome = 'saved' | 'queued' | 'conflict';

/**
 * Save a document that can be edited offline. It's kept on this device
 * first, then sent; returns whether it reached the server, is waiting to, or
 * needs a decision (the conflict dialog shows itself).
 */
export async function saveEdit(opts: { key: string; url: string; label: string; band: string; data: unknown }): Promise<SaveOutcome> {
  const me = await whoAmI();
  const id = editId(me.id, opts.key);
  const existing = await getEdit(id);
  await putEdit(coalesce(existing, {
    ...opts,
    id,
    userId: me.id,
    userName: me.name,
    kind: mergeKindOf(opts.key),
    base: knownBase(opts.key),
    baseRev: knownRev(opts.key),
    state: 'pending',
    savedAt: Date.now(),
  }));
  await syncNow();
  const after = await getEdit(id);
  if (!after) return 'saved';
  return after.state === 'conflict' ? 'conflict' : 'queued';
}

/**
 * Read a document: the edit waiting on this device if there is one (so it
 * shows after a reload, even though the server and the offline cache have
 * the older copy), otherwise the server, otherwise the offline cache.
 */
export async function readDoc(key: string): Promise<Response> {
  const { id } = await whoAmI();
  // Only your own: someone else's waiting edit on this device isn't shown to you.
  const edit = id ? await getEdit(editId(id, key)).catch(() => undefined) : undefined;
  if (edit) {
    return new Response(JSON.stringify(edit.data), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Local-Edit': '1' } });
  }
  // A song opened from a link may already be downloading (src/data/prefetch.ts).
  return prefetchedOr(key, () => fetchDoc(key));
}

/** The edit (by `id`) waiting for a decision. */
export function getConflict(id: string): Promise<PendingEdit | undefined> {
  return getEdit(id);
}

async function send(edit: PendingEdit): Promise<Response> {
  const query = new URLSearchParams();
  if (edit.baseRev !== undefined) query.set('baseRev', String(edit.baseRev));
  // Whose edit this is: the server refuses it under anyone else's session.
  if (edit.userId) query.set('asUser', edit.userId);
  const target = `${edit.url}${edit.url.includes('?') ? '&' : '?'}${query}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit.data),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** It's on the server: drop the waiting copy, unless it was saved again while sending. */
async function settled(edit: PendingEdit, rev: number | undefined, serverCopy: unknown): Promise<void> {
  setKnown(edit.key, rev, serverCopy);
  const now = await getEdit(edit.id);
  if (now && now.savedAt !== edit.savedAt) await putEdit({ ...now, base: serverCopy, baseRev: rev });
  else await deleteEdit(edit.id);
}

/** Send one edit. 'stop': the server can't be reached (or wants a sign-in); try again later. */
async function syncOne(edit: PendingEdit, attempt = 0): Promise<'next' | 'stop'> {
  let res: Response;
  try {
    res = await send(edit);
  } catch {
    markOffline();
    return 'stop';
  }
  noteResponse(edit.url, res);
  if (res.status >= 500) {
    markOffline();
    return 'stop';
  }
  markOnline();
  const json = await res.json().catch(() => ({})) as { error?: string; code?: string; rev?: number | null; current?: unknown };

  if (res.ok) {
    await settled(edit, typeof json.rev === 'number' ? json.rev : undefined, edit.data);
    return 'next';
  }
  if (res.status === 401) {
    useConnectivity.setState({ needsSignIn: true });
    return 'stop';
  }
  // Someone else is signed in now (in another tab, say): held for its maker.
  if (res.status === 403 && json.code === 'wrong-user') return 'stop';
  if (res.status === 409 && 'current' in json) {
    const current = json.current ?? null;
    const rev = json.rev ?? 0;
    const outcome = resolveConflict(edit.kind, edit.base, edit.data, current);
    if (outcome.type === 'done') {
      await settled(edit, rev, current);
      emit(edit.key, current);
      return 'next';
    }
    if (outcome.type === 'resend' && attempt < 3) {
      const merged: PendingEdit = { ...edit, data: outcome.data, base: current, baseRev: rev };
      await putEdit(merged);
      // What's on screen becomes the merge (my timing plus their mix).
      if (outcome.data !== edit.data) emit(edit.key, outcome.data);
      return syncOne(merged, attempt + 1);
    }
    await putEdit({ ...edit, state: 'conflict', conflict: { current, rev } });
    return 'next';
  }
  // Refused for good (403: no longer allowed; 400: not valid): it can't be saved.
  await deleteEdit(edit.id);
  toast(res.status === 403
    ? `Your change to ${edit.label} couldn’t be saved: you can’t edit it any more.`
    : `Your change to ${edit.label} couldn’t be saved: ${json.error ?? `error ${res.status}`}.`, 'error');
  return 'next';
}

let running: Promise<void> | null = null;
let again = false;

async function runSync(): Promise<void> {
  if (useConnectivity.getState().needsSignIn) return;
  const waiting = (await myEdits()).filter((e) => e.state === 'pending').sort((a, b) => a.savedAt - b.savedAt);
  if (waiting.length === 0) return;
  useConnectivity.setState({ syncing: true });
  try {
    for (const edit of waiting) {
      if ((await syncOne(edit)) === 'stop') break;
    }
  } finally {
    useConnectivity.setState({ syncing: false });
  }
}

/** Send everything waiting, now. One run at a time (across tabs, where the browser can). */
export function syncNow(): Promise<void> {
  if (!supported()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const locked = () => (navigator.locks ? navigator.locks.request('pp-sync', () => runSync()) : runSync());
  running = (async () => {
    try {
      do {
        again = false;
        await locked();
      } while (again);
    } catch (err) {
      console.warn('[sync] failed', err);
    } finally {
      running = null;
      await refreshCounts();
    }
  })();
  return running;
}

/** "Keep mine": send my edit (by `id`) over theirs. */
export async function keepMine(id: string): Promise<void> {
  const edit = await getEdit(id);
  if (!edit?.conflict) return;
  await putEdit({ ...edit, state: 'pending', base: edit.conflict.current, baseRev: edit.conflict.rev, conflict: undefined });
  await syncNow();
}

/** "Keep theirs": drop my edit (by `id`), and show theirs. */
export async function keepTheirs(id: string): Promise<void> {
  const edit = await getEdit(id);
  if (!edit?.conflict) return;
  setKnown(edit.key, edit.conflict.rev, edit.conflict.current);
  await deleteEdit(id);
  emit(edit.key, edit.conflict.current);
  await refreshCounts();
}

/** Discard the edits other accounts left on this device (they won't be back to send them). */
export async function discardOthersEdits(): Promise<void> {
  const { id } = await whoAmI();
  for (const e of await allEdits()) if (!id || e.userId !== id) await deleteEdit(e.id);
  await refreshCounts();
}

/** Whether the server answers, for when nothing is waiting to tell us. */
async function probe(): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch('/api/me', { cache: 'no-store', signal: ctrl.signal });
    noteResponse('/api/me', res);
  } catch {
    markOffline();
  } finally {
    clearTimeout(timer);
  }
}

let started = false;

/** Start syncing in the background. Once, at app start. */
export function startSync(): void {
  if (started || !supported() || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => { void probe().then(syncNow); });
  window.addEventListener('offline', markOffline);
  // Back online after being offline: send what's waiting.
  useConnectivity.subscribe((s, prev) => {
    if (s.online && !prev.online) void syncNow();
  });
  // Signed in (or as someone else): their edits are the ones to show and send.
  useSessionStore.subscribe((s, prev) => {
    if (s.user?.id !== prev.user?.id || s.loaded !== prev.loaded) void refreshCounts().then(syncNow);
  });
  setInterval(() => {
    const { pending, online } = useConnectivity.getState();
    if (pending > 0) void syncNow();
    else if (!online) void probe();
  }, RETRY_MS);
  void refreshCounts().then(syncNow);
}
