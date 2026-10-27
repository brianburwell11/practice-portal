/**
 * Sign in with Google — OpenID Connect authorization-code flow with PKCE.
 *
 * No client library: three requests' worth of protocol, and every check is
 * here to read. The ID token's signature is not verified, deliberately: it
 * arrives straight from Google's token endpoint over TLS, in exchange for a
 * code plus our client secret, which OIDC Core §3.1.3.7 accepts in place of
 * signature validation. Its claims are still checked — issuer, audience,
 * expiry, nonce, and a verified email.
 */
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const CALLBACK_PATH = '/api/auth/google/callback';

function client(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, 'Google sign-in is not configured');
  return { id, secret };
}

/** What we hold in a short-lived cookie between leaving for Google and coming back. */
export interface PendingSignIn {
  state: string;
  nonce: string;
  verifier: string;
  /** Same-site path to return to afterwards. */
  next: string;
}

const random = () => randomBytes(32).toString('base64url');

export function beginSignIn(origin: string, next: string): { url: string; pending: PendingSignIn } {
  const { id } = client();
  const pending: PendingSignIn = { state: random(), nonce: random(), verifier: random(), next };
  const challenge = createHash('sha256').update(pending.verifier).digest('base64url');
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: origin + CALLBACK_PATH,
    response_type: 'code',
    scope: 'openid email profile',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Always show the account chooser: band members share family laptops.
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), pending };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
}

/** Decode a JWT's payload. Callers check the claims; see the module comment on signatures. */
function decodeClaims(jwt: string): IdTokenClaims {
  const payload = jwt.split('.')[1];
  if (!payload) throw new HttpError(502, 'Malformed ID token from Google');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IdTokenClaims;
}

/**
 * Validate an ID token's claims against this sign-in. Exported so the checks
 * can be tested without a round trip to Google.
 */
export function checkClaims(claims: IdTokenClaims, expect: { clientId: string; nonce: string; now?: number }): GoogleIdentity {
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new HttpError(401, 'ID token has the wrong issuer');
  if (claims.aud !== expect.clientId) throw new HttpError(401, 'ID token is for a different client');
  if (!claims.exp || claims.exp < now) throw new HttpError(401, 'ID token has expired');
  if (!claims.nonce || claims.nonce !== expect.nonce) throw new HttpError(401, 'ID token nonce mismatch');
  if (!claims.sub) throw new HttpError(401, 'ID token has no subject');
  // Google sends a boolean today; older tokens used the string "true".
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new HttpError(403, 'Your Google account email is not verified');
  }
  if (!claims.email) throw new HttpError(401, 'ID token has no email');
  return { sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture };
}

export async function finishSignIn(origin: string, code: string, pending: PendingSignIn): Promise<GoogleIdentity> {
  const { id, secret } = client();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: origin + CALLBACK_PATH,
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  });
  if (!res.ok) {
    // Google's error body names the problem (e.g. invalid_grant) without secrets.
    throw new HttpError(401, `Google rejected the sign-in (${res.status}: ${(await res.text()).slice(0, 200)})`);
  }
  const { id_token: idToken } = await res.json() as { id_token?: string };
  if (!idToken) throw new HttpError(502, 'Google returned no ID token');
  return checkClaims(decodeClaims(idToken), { clientId: id, nonce: pending.nonce });
}
