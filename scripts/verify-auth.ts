/**
 * Offline checks for Google sign-in: every ID-token claim we rely on, the
 * redirect to Google, and the callback refusing anything it didn't start.
 *
 *   npx tsx scripts/verify-auth.ts
 *
 * No Google credentials or database needed — the paths exercised here fail
 * before either is touched.
 */
import type { IncomingMessage } from 'node:http';
import { requestOrigin } from '../server/adapters/nodeApi';
import { parseCookies } from '../server/core/auth/cookies';
import { checkClaims } from '../server/core/auth/google';
import { googleCallback, googleStart } from '../server/core/handlers/auth';
import type { CoreRequest } from '../server/core/types';

process.env.GOOGLE_CLIENT_ID = 'client-123';
process.env.GOOGLE_CLIENT_SECRET = 'unused-here';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failures++;
}
function throws(label: string, fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
    check(label, false, 'did not throw');
  } catch (err) {
    check(label, pattern.test(String((err as Error).message)), String((err as Error).message));
  }
}

const now = 1_800_000_000;
const good = {
  iss: 'https://accounts.google.com', aud: 'client-123', exp: now + 300, nonce: 'n1',
  sub: '1234', email: 'player@example.com', email_verified: true, name: 'Player',
};
const expect = { clientId: 'client-123', nonce: 'n1', now };

function req(query: Record<string, string>, cookies: Record<string, string> = {}): CoreRequest {
  return { params: {}, query: new URLSearchParams(query), cookies, origin: 'https://practice-portal.fly.dev' };
}

async function main(): Promise<void> {
  console.log('--- ID token claims');
  check('valid token accepted', checkClaims(good, expect).sub === '1234');
  check('legacy "true" email_verified accepted', checkClaims({ ...good, email_verified: 'true' }, expect).email === good.email);
  check('bare issuer accepted', !!checkClaims({ ...good, iss: 'accounts.google.com' }, expect));
  throws('wrong issuer rejected', () => checkClaims({ ...good, iss: 'https://evil.example' }, expect), /issuer/);
  throws('token for another client rejected', () => checkClaims({ ...good, aud: 'other' }, expect), /different client/);
  throws('expired token rejected', () => checkClaims({ ...good, exp: now - 1 }, expect), /expired/);
  throws('nonce mismatch rejected', () => checkClaims({ ...good, nonce: 'n2' }, expect), /nonce/);
  throws('missing nonce rejected', () => checkClaims({ ...good, nonce: undefined }, expect), /nonce/);
  throws('unverified email rejected', () => checkClaims({ ...good, email_verified: false }, expect), /not verified/);
  throws('missing subject rejected', () => checkClaims({ ...good, sub: undefined }, expect), /subject/);

  console.log('\n--- request origin (feeds redirect_uri and the CSRF check)');
  const origin = (headers: Record<string, string>, encrypted: boolean) =>
    requestOrigin({ headers, socket: { encrypted } } as unknown as IncomingMessage);
  check('HTTP/1.1 Host header', origin({ host: 'localhost:5173' }, true) === 'https://localhost:5173');
  check('HTTP/2 :authority (Vite dev over https)', origin({ ':authority': 'localhost:5173' }, true) === 'https://localhost:5173',
    origin({ ':authority': 'localhost:5173' }, true));
  check('behind Fly: X-Forwarded-Proto wins', origin({ host: 'practice-portal.fly.dev', 'x-forwarded-proto': 'https' }, false)
    === 'https://practice-portal.fly.dev');

  console.log('\n--- start');
  const start = await googleStart(req({ next: '/dirtychaignv?x=1' }));
  const location = new URL(String(start.headers?.Location));
  const pendingCookie = ([] as string[]).concat(start.headers?.['Set-Cookie'] ?? [])[0] ?? '';
  check('redirects to Google', start.status === 302 && location.host === 'accounts.google.com');
  check('redirect_uri is this origin\'s callback',
    location.searchParams.get('redirect_uri') === 'https://practice-portal.fly.dev/api/auth/google/callback');
  check('PKCE S256 challenge sent', location.searchParams.get('code_challenge_method') === 'S256' && !!location.searchParams.get('code_challenge'));
  check('state and nonce sent', !!location.searchParams.get('state') && !!location.searchParams.get('nonce'));
  check('pending cookie is httpOnly, Secure, Lax, scoped, short-lived',
    /HttpOnly/.test(pendingCookie) && /Secure/.test(pendingCookie) && /SameSite=Lax/.test(pendingCookie)
    && /Path=\/api\/auth\/google/.test(pendingCookie) && /Max-Age=600/.test(pendingCookie), pendingCookie);
  const pendingValue = parseCookies(pendingCookie.split(';')[0]).pp_oauth;
  const pending = JSON.parse(Buffer.from(pendingValue, 'base64url').toString()) as { state: string; verifier: string; next: string };
  check('verifier stays server-side (not in the URL)', !location.toString().includes(pending.verifier));
  check('next path preserved', pending.next === '/dirtychaignv?x=1');

  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'evil']) {
    const s = await googleStart(req({ next: bad }));
    const v = ([] as string[]).concat(s.headers?.['Set-Cookie'] ?? [])[0].split(';')[0].split('=')[1];
    const n = (JSON.parse(Buffer.from(decodeURIComponent(v), 'base64url').toString()) as { next: string }).next;
    check(`open redirect refused: ${bad}`, n === '/', `next became ${n}`);
  }

  console.log('\n--- callback refuses what it didn\'t start');
  const noCookie = await googleCallback(req({ state: pending.state, code: 'c' }));
  check('no pending cookie → back with an error, no session',
    noCookie.status === 302 && /signin_error/.test(String(noCookie.headers?.Location))
    && !([] as string[]).concat(noCookie.headers?.['Set-Cookie'] ?? []).some((c) => c.startsWith('pp_session=')));
  const forged = await googleCallback(req({ state: 'attacker-state', code: 'c' }, { pp_oauth: pendingValue }));
  check('state mismatch → error, no session',
    /signin_error/.test(String(forged.headers?.Location))
    && !([] as string[]).concat(forged.headers?.['Set-Cookie'] ?? []).some((c) => c.startsWith('pp_session=')));
  const denied = await googleCallback(req({ state: pending.state, error: 'access_denied' }, { pp_oauth: pendingValue }));
  check('cancelled at Google → friendly error, back to the page',
    String(denied.headers?.Location).startsWith('/dirtychaignv?x=1&signin_error=Sign-in%20was%20cancelled'), String(denied.headers?.Location));

  console.log(`\n===== ${failures} failure(s) =====`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
