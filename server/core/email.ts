/**
 * Outgoing email, through Resend's HTTP API (`POST /emails`) — no SDK.
 *
 *   RESEND_API_KEY  required to send. Without it every email is logged
 *                   instead, so dev and tests run without an account.
 *   EMAIL_FROM      sender; defaults to the practiceportal.app no-reply
 *                   address, whose domain must be verified in Resend.
 *   RESEND_API_URL  API base, for pointing tests at a local stand-in.
 *
 * Sending is best effort: callers have already committed what the email is
 * about, so a failure is logged and reported, never thrown. Handlers use
 * `sendEmailLater`, so a request never waits on Resend; shutdown waits for
 * whatever is still sending (`drainEmails`).
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import * as schema from '../db/schema';

const DEFAULT_FROM = 'Practice Portal <do-not-reply@practiceportal.app>';

export interface Email {
  to: string;
  subject: string;
  /** Plain text. Every email is sent as text and as HTML built from `html`. */
  text: string;
  html: string;
  /** Where a reply goes, since nobody reads do-not-reply. */
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

/** The longest any user-written text runs in an email. */
export const EMAIL_TEXT_MAX = 100;

/**
 * Text someone else wrote (a band name, a display name, a request message),
 * made safe to put in an email: no links, nothing a mail client would turn
 * into one, and at most `EMAIL_TEXT_MAX` characters. Escape it too for HTML.
 */
export function emailText(s: string | null | undefined, fallback = ''): string {
  const cleaned = (s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    // Anything with a scheme (https:, mailto:, javascript:), then www. names,
    // then email addresses and bare domains (example.com/path).
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '')
    .replace(/\b(?:mailto|javascript|data|tel):\S*/gi, '')
    .replace(/\bwww\.\S*/gi, '')
    .replace(/\S+@\S+\.\S+/g, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:\/\S*)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > EMAIL_TEXT_MAX ? `${cleaned.slice(0, EMAIL_TEXT_MAX - 1).trimEnd()}…` : cleaned;
}

/** Whether an address asked not to be emailed (the link in invite emails). */
export async function isBlocked(address: string): Promise<boolean> {
  const [row] = await db().select({ email: schema.emailBlock.email }).from(schema.emailBlock)
    .where(eq(schema.emailBlock.email, address));
  return !!row;
}

/** Escape text for an HTML body — every name and message in an email is user input. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Where links in emails point: the site's one public address on Fly
 * (CANONICAL_HOST), never whatever Host header a request arrived with.
 */
export function emailLinkOrigin(requestOrigin: string): string {
  const host = process.env.CANONICAL_HOST?.trim();
  return host ? `https://${host}` : requestOrigin;
}

/** A plain, client-safe HTML email: paragraphs, at most one button, and an optional small footer link. */
export function htmlEmail(
  paragraphs: string[],
  button?: { label: string; url: string },
  footerLink?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${body}${cta}<p style="margin:24px 0 0;font-size:12px;color:#666">Practice Portal · practiceportal.app${
    footerLink ? ` · <a href="${escapeHtml(footerLink.url)}" style="color:#666">${escapeHtml(footerLink.label)}</a>` : ''
  }</p></div>`;
}

/** Emails still sending, so shutdown can wait for them. */
const inFlight = new Set<Promise<unknown>>();

/** Whether emails go out at all, or are only logged (no RESEND_API_KEY). */
export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Send in the background and return at once. `email` may be a function, for
 * an email that needs a lookup first; it runs in the background too. Returns
 * whether the email is on its way: false means it's only logged.
 */
export function sendEmailLater(email: Email | (() => Promise<Email>)): boolean {
  const task = (async () => {
    try {
      const message = typeof email === 'function' ? await email() : email;
      if (await isBlocked(message.to)) {
        console.log(`[email] ${message.to} asked not to be emailed; not sending "${message.subject}"`);
        return;
      }
      await sendEmail(message);
    } catch (err) {
      console.error('[email] preparing an email failed:', err);
    }
  })();
  inFlight.add(task);
  void task.finally(() => inFlight.delete(task));
  return emailEnabled();
}

/** Wait for background emails to finish, up to `ms`. */
export async function drainEmails(ms = 8_000): Promise<void> {
  if (inFlight.size === 0) return;
  console.log(`[email] waiting for ${inFlight.size} email(s) to finish sending`);
  await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => setTimeout(r, ms).unref())]);
}

/** Send one email. Resolves to whether it was sent (false: logged only, or failed). */
export async function sendEmail(email: Email): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] RESEND_API_KEY not set — not sending "${email.subject}" to ${email.to}`);
    return false;
  }
  const base = (process.env.RESEND_API_URL ?? 'https://api.resend.com').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[email] Resend refused "${email.subject}" (${res.status}):`, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email] sending "${email.subject}" failed:`, err);
    return false;
  }
}
