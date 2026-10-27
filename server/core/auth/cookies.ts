/**
 * Cookie parsing and serialization. Every cookie this app sets is httpOnly,
 * Secure and SameSite=Lax: unreadable from JavaScript, never sent over plain
 * HTTP, and not attached to cross-site POSTs.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (name in out) continue; // first wins, as browsers order most-specific first
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // malformed value — ignore the cookie rather than the request
    }
  }
  return out;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; path?: string }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${opts.maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function clearCookie(name: string, path = '/'): string {
  return setCookie(name, '', { maxAge: 0, path });
}
