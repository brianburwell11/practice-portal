/**
 * Rate limits, per client IP, kept in memory. There's one server process
 * (one Fly machine), so memory is the whole picture; a restart forgets.
 *
 *   auth       5 sign-in attempts per 15 minutes, counted separately for
 *              starting a Google sign-in and for its callback
 *   tokens     30 per 15 minutes on routes that take a secret token in the
 *              URL (invite links, guest links, email opt-out), so guessing one is hopeless
 *   writes     300 per 15 minutes for every other change
 *   reads      1500 per 5 minutes for everything else: a whole band behind
 *              one rehearsal-room IP, each opening setlists and songs
 *
 * RATE_LIMIT=off turns it off, for scripts that hammer a local server.
 */

interface Limit {
  max: number;
  windowMs: number;
}

const MINUTE = 60_000;

export const LIMITS = {
  auth: { max: 5, windowMs: 15 * MINUTE },
  tokens: { max: 30, windowMs: 15 * MINUTE },
  writes: { max: 300, windowMs: 15 * MINUTE },
  reads: { max: 1500, windowMs: 5 * MINUTE },
} satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

/** Which limit a route counts against. */
export function limitFor(routeName: string, method: string): { name: LimitName; bucket: string } {
  if (routeName === 'auth.google.start' || routeName === 'auth.google.callback') {
    return { name: 'auth', bucket: routeName };
  }
  if (['invite.preview', 'invite.accept', 'guest.open', 'email.block.get', 'email.block'].includes(routeName)) {
    return { name: 'tokens', bucket: 'tokens' };
  }
  return method === 'GET' || method === 'HEAD'
    ? { name: 'reads', bucket: 'reads' }
    : { name: 'writes', bucket: 'writes' };
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
/** Past this many tracked keys, expired ones are swept before adding more. */
const SWEEP_AT = 50_000;

function sweep(now: number): void {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the window resets, for Retry-After. */
  retryAfter: number;
}

/** Count one request from `ip` against `name`. */
export function hit(name: LimitName, bucket: string, ip: string, now = Date.now()): LimitResult {
  if (process.env.RATE_LIMIT === 'off') return { allowed: true, retryAfter: 0 };
  const { max, windowMs } = LIMITS[name];
  const key = `${bucket}|${ip}`;
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= SWEEP_AT) sweep(now);
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count++;
  return { allowed: w.count <= max, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
}

/** Forget every window. For tests. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The caller's IP. On Fly, its proxy sets Fly-Client-IP and a client can't
 * forge it; anywhere else the socket address is all there is.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const fly = process.env.FLY_APP_NAME ? req.headers['fly-client-ip'] : undefined;
  return (typeof fly === 'string' && fly) || req.socket?.remoteAddress || 'unknown';
}
