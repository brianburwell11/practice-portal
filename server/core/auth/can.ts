/**
 * `can(actor, capability, band)` — the first slice of Phase 6.
 *
 * Resolves the actor's role in the band (the Owner from `band.owner_user_id`,
 * everyone else from `membership`), then asks the `role_capability` table.
 * The tables are authoritative at runtime — never `capabilities.ts`, which is
 * only their seed — so re-cutting a role bundle needs no deploy.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client';
import * as schema from '../../db/schema';
import type { Capability } from '../../db/capabilities';
import { HttpError } from '../http';
import type { Actor } from '../types';

export interface BandRef {
  id: string;
  legacyId: string | null;
  name: string;
  ownerUserId: string;
  visibility: string;
}

/** A live band by the legacy id the SPA and every R2 key use. 404 if absent. */
export async function bandByLegacyId(legacyId: string): Promise<BandRef> {
  const [band] = await db().select({
    id: schema.band.id,
    legacyId: schema.band.legacyId,
    name: schema.band.name,
    ownerUserId: schema.band.ownerUserId,
    visibility: schema.band.visibility,
  }).from(schema.band).where(and(eq(schema.band.legacyId, legacyId), isNull(schema.band.deletedAt)));
  if (!band) throw new HttpError(404, 'Band not found');
  return band;
}

/** The user's role key in the band, or null if they aren't in it. */
export async function roleIn(userId: string, band: BandRef): Promise<string | null> {
  if (band.ownerUserId === userId) return 'owner';
  const [m] = await db().select({ role: schema.membership.role }).from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.bandId, band.id)));
  return m?.role ?? null;
}

export async function roleHas(role: string, capability: Capability): Promise<boolean> {
  const [row] = await db().select({ k: schema.roleCapability.capabilityKey }).from(schema.roleCapability)
    .where(and(eq(schema.roleCapability.roleKey, role), eq(schema.roleCapability.capabilityKey, capability)));
  return !!row;
}

export async function can(actor: Actor | undefined, capability: Capability, band: BandRef): Promise<boolean> {
  if (!actor) return false;
  const role = await roleIn(actor.userId, band);
  return role !== null && roleHas(role, capability);
}

/** Throw 401 for anonymous callers and 403 for those without the capability. */
export async function requireCan(actor: Actor | undefined, capability: Capability, band: BandRef): Promise<Actor> {
  if (!actor) throw new HttpError(401, 'Sign in required');
  if (!(await can(actor, capability, band))) {
    throw new HttpError(403, "You don't have permission to do that in this band");
  }
  return actor;
}

/** Lower `sort_order` is more privileged: Owner 0, Manager 1, Editor 2, Member 3. */
export async function roleRank(role: string): Promise<number> {
  const [r] = await db().select({ sortOrder: schema.role.sortOrder }).from(schema.role).where(eq(schema.role.key, role));
  if (!r) throw new HttpError(400, `Unknown role "${role}"`);
  return r.sortOrder;
}

/** Roles that may be granted through an invite or the roster (not owner, not guest). */
export async function isAssignable(role: string): Promise<boolean> {
  const [r] = await db().select({ eligible: schema.role.membershipEligible }).from(schema.role).where(eq(schema.role.key, role));
  return !!r?.eligible;
}
