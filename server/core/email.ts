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
 * about, so a failure is logged and reported, never thrown.
 */

const DEFAULT_FROM = 'Practice Portal <do-not-reply@practiceportal.app>';

export interface Email {
  to: string;
  subject: string;
  /** Plain text. Every email is sent as text and as HTML built from `html`. */
  text: string;
  html: string;
  /** Where a reply goes, since nobody reads do-not-reply. */
  replyTo?: string;
}

/** Escape text for an HTML body — every name and message in an email is user input. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A plain, client-safe HTML email: paragraphs and at most one button. */
export function htmlEmail(paragraphs: string[], button?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:520px">${body}${cta}<p style="margin:24px 0 0;font-size:12px;color:#666">Practice Portal · practiceportal.app</p></div>`;
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
