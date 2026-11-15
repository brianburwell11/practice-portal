import { create } from 'zustand';
import { toast } from '../store/dialogStore';

/**
 * Whether the app can reach the server, and the state of edits waiting to
 * sync. "Online" isn't `navigator.onLine` alone: wifi can be connected and
 * reach nothing (a plane, a hotel), so a failed request or an answer from the
 * offline cache (`X-Offline-Cache`) counts as offline too, and a real answer
 * from the server as online.
 */
export interface WaitingEdit {
  /** The record's id (per account and document). */
  id: string;
  key: string;
  label: string;
}

interface ConnectivityState {
  online: boolean;
  /** Edits saved on this device, not yet on the server. */
  pending: number;
  /** Edits that need a decision (someone else changed the same thing). */
  conflicts: WaitingEdit[];
  syncing: boolean;
  /** The server said the session is over: sync waits for a sign-in. */
  needsSignIn: boolean;
  /** Edits other accounts left on this device, held for them. */
  held: number;
  /** Their names. */
  heldFor: string[];
}

export const useConnectivity = create<ConnectivityState>(() => ({
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  pending: 0,
  conflicts: [],
  syncing: false,
  needsSignIn: false,
  held: 0,
  heldFor: [],
}));

export function markOffline(): void {
  if (useConnectivity.getState().online) useConnectivity.setState({ online: false });
}

export function markOnline(): void {
  if (!useConnectivity.getState().online) useConnectivity.setState({ online: true });
}

/** Note what a response says about reaching the server. Only our own API counts. */
export function noteResponse(url: string, res: Response): void {
  if (!url.startsWith('/api/')) return;
  if (res.headers.get('X-Offline-Cache')) markOffline();
  else if (res.status < 500) markOnline();
}

export const OFFLINE_MESSAGE = 'Available when you’re back online.';

/**
 * For changes that need the server (notes, the mix, song details, setlists):
 * false, with a message, when it can't be reached.
 */
export function onlineOrSay(): boolean {
  if (useConnectivity.getState().online) return true;
  toast(OFFLINE_MESSAGE);
  return false;
}

/**
 * `fetch` for a write that needs the server: refuses straight away when
 * offline, and gives up after `timeoutMs` (wifi that reaches nothing never
 * fails, it just doesn't answer). Either way it throws `OFFLINE_MESSAGE`.
 */
export async function onlineFetch(input: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  if (!useConnectivity.getState().online) throw new Error(OFFLINE_MESSAGE);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    noteResponse(input, res);
    return res;
  } catch {
    markOffline();
    throw new Error(OFFLINE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}
