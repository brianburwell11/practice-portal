/**
 * Signing in the iPhone home screen app through another browser window.
 *
 * Google's sign-in hangs inside an iOS home screen app (after two-step
 * verification), so the app opens the sign-in in a window of its own, and
 * that window can't hand back a cookie: its storage isn't the app's. Instead:
 *
 *   1. The app makes up an id and a secret, opens the window on the id, and
 *      registers both here. It gets back a short code to show.
 *   2. The window signs in with Google as usual, shows the same code, and the
 *      person confirms it: that ties the window's account to the id.
 *   3. The app, polling with the secret, collects a session of its own.
 *
 * Only the app ever holds the secret, so knowing an id (it's in the window's
 * address) isn't enough to collect anything. The code is there so a stranger
 * can't send you a link that signs *their* app in as you: you'd be asked to
 * confirm a code no app of yours is showing.
 *
 * Kept in memory, like the rate limits: there's one server process, and a
 * restart only costs a sign-in that was halfway through.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000;
/** Plenty for every sign-in in flight; past it, the oldest go. */
const MAX_PENDING = 1000;

interface Handoff {
  secretHash: Buffer;
  code: string;
  expiresAt: number;
  /** Set once the window's account confirms it. */
  userId?: string;
}

const pending = new Map<string, Handoff>();

const hash = (secret: string) => createHash('sha256').update(secret).digest();

function sweep(now: number): void {
  for (const [id, h] of pending) if (h.expiresAt <= now) pending.delete(id);
  // Map order is insertion order, so the first are the oldest.
  for (const id of pending.keys()) {
    if (pending.size <= MAX_PENDING) break;
    pending.delete(id);
  }
}

function live(id: string): Handoff | undefined {
  const h = pending.get(id);
  if (!h) return undefined;
  if (h.expiresAt <= Date.now()) {
    pending.delete(id);
    return undefined;
  }
  return h;
}

/** Register a sign-in. Returns the code to show, or undefined if the id is taken. */
export function createHandoff(id: string, secret: string): string | undefined {
  const now = Date.now();
  sweep(now);
  if (pending.has(id)) return undefined;
  const code = String(randomInt(0, 10000)).padStart(4, '0');
  pending.set(id, { secretHash: hash(secret), code, expiresAt: now + TTL_MS });
  return code;
}

/** The code the app is showing, while the sign-in is open and unconfirmed. */
export function handoffCode(id: string): string | undefined {
  const h = live(id);
  return h && !h.userId ? h.code : undefined;
}

/** The window's account confirms the code. False if it's gone or already confirmed. */
export function approveHandoff(id: string, userId: string): boolean {
  const h = live(id);
  if (!h || h.userId) return false;
  h.userId = userId;
  return true;
}

/**
 * The app collects its sign-in: the account, once confirmed (and the
 * sign-in is used up), or 'pending' until then, or undefined if the id and
 * secret don't match an open sign-in.
 */
export function claimHandoff(id: string, secret: string): { userId: string } | 'pending' | undefined {
  const h = live(id);
  if (!h || !timingSafeEqual(h.secretHash, hash(secret))) return undefined;
  if (!h.userId) return 'pending';
  pending.delete(id);
  return { userId: h.userId };
}
