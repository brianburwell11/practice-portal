/**
 * "Don't email me again", from the link in an invite email. The invite's own
 * token is the proof: only whoever got the email has it, so nobody can block
 * someone else's address.
 *
 *   GET  /api/email/block?token=…   which address the link is for, and whether it's blocked
 *   POST /api/email/block?token=…   block it. Also what a mail app's one-click
 *                                   unsubscribe button posts (List-Unsubscribe).
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import { hashToken } from '../auth/sessions';
import { isBlocked } from '../email';
import { HttpError, json } from '../http';
import type { CoreRequest, CoreResponse } from '../types';

async function addressFor(req: CoreRequest): Promise<string> {
  const token = req.query.get('token') ?? '';
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw new HttpError(400, 'This link isn’t valid');
  const [row] = await db().select({ email: schema.invite.email }).from(schema.invite)
    .where(eq(schema.invite.tokenHash, hashToken(token)));
  if (!row?.email) throw new HttpError(404, 'This link isn’t valid');
  return row.email;
}

export async function getEmailBlock(req: CoreRequest): Promise<CoreResponse> {
  const email = await addressFor(req);
  return json({ email, blocked: await isBlocked(email) });
}

export async function blockEmail(req: CoreRequest): Promise<CoreResponse> {
  const email = await addressFor(req);
  await db().insert(schema.emailBlock).values({ email }).onConflictDoNothing();
  return json({ email, blocked: true });
}
