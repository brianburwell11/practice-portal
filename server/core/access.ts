/**
 * Who may call a route (Phase 6). Every route declares `access`; the router
 * enforces it before the handler runs, on every host — the Vite dev server
 * and Fly alike. A route without a declaration is refused (see
 * `scripts/verify-access.ts`, which fails the build on one).
 *
 *   'public'         anyone, signed in or not
 *   'signedIn'       any signed-in user; the handler (or `authorize`) decides more
 *   'platformAdmin'  an address in ADMIN_EMAILS
 *   a capability     the caller holds it in the route's band (`params.bandId`)
 *
 * Some routes need more than one fixed capability. `authorizePath` refines
 * the check from the path alone and runs before any upload is read;
 * `authorizeBody` needs the JSON body — a song config save that touches the
 * tapMap needs `song.timing.write` even though most of the save is content.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Capability } from '../db/capabilities';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { bandByLegacyId, can, type BandRef } from './auth/can';
import { HttpError } from './http';
import type { Actor, CoreRequest } from './types';

export type Access = 'public' | 'signedIn' | 'platformAdmin' | Capability;

const SPECIAL = new Set(['public', 'signedIn', 'platformAdmin']);

export function isCapabilityAccess(access: Access): access is Capability {
  return !SPECIAL.has(access);
}

export function isPlatformAdmin(actor: Actor | undefined): boolean {
  if (!actor) return false;
  const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(actor.email.toLowerCase());
}

function requireActor(actor: Actor | undefined): Actor {
  if (!actor) throw new HttpError(401, 'Sign in required');
  return actor;
}

/** Throw unless the actor holds every capability in the band. */
export async function requireCapabilities(actor: Actor | undefined, band: BandRef, caps: Capability[]): Promise<void> {
  const who = requireActor(actor);
  for (const cap of caps) {
    if (!(await can(who, cap, band))) {
      throw new HttpError(403, `You don't have permission to do that in this band (${cap})`);
    }
  }
}

/** The declared access, checked before the body is read. */
export async function authorizeAccess(access: Access, req: Pick<CoreRequest, 'params' | 'actor'>): Promise<void> {
  if (access === 'public') return;
  const actor = requireActor(req.actor);
  if (access === 'signedIn') return;
  if (access === 'platformAdmin') {
    if (!isPlatformAdmin(actor)) throw new HttpError(403, 'Only a site admin can do that');
    return;
  }
  const bandId = req.params.bandId;
  if (!bandId) throw new HttpError(500, `Route requires ${access} but has no band in its path`);
  await requireCapabilities(actor, await bandByLegacyId(bandId), [access]);
}

// ---------------------------------------------------- per-route refinements

/** Fields of a song config, by the capability that governs changing them. */
const CONFIG_FIELDS: Record<string, Capability> = {
  tapMap: 'song.timing.write',
  tempoMap: 'song.timing.write',
  timeSignatureMap: 'song.timing.write',
  markers: 'song.timing.write',
  beatOffset: 'song.timing.write',
  audioOffsetSeconds: 'song.timing.write',
  stems: 'song.audio.write',
  groups: 'song.audio.write',
  mixerOrder: 'song.audio.write',
  sheetMusicUrl: 'song.score.write',
  equalBeatWidth: 'song.score.write',
  repeatAfterDcDs: 'song.score.write',
};

const canonical = (v: unknown) => JSON.stringify(v ?? null, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val);

/**
 * The capabilities a config save needs: `song.create` for a new song,
 * otherwise one per kind of field that actually changed. Saving an unchanged
 * config needs `song.content.write` — someone has to be allowed to press save.
 */
export function configSaveCapabilities(before: Record<string, unknown> | null, after: Record<string, unknown>): Capability[] {
  if (!before) return ['song.create'];
  const needed = new Set<Capability>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonical(before[key]) === canonical(after[key])) continue;
    needed.add(CONFIG_FIELDS[key] ?? 'song.content.write');
  }
  if (needed.size === 0) needed.add('song.content.write');
  return [...needed];
}

async function storedConfig(band: BandRef, songId: string): Promise<Record<string, unknown> | null> {
  const [row] = await db().select({ config: schema.song.config }).from(schema.song).where(and(
    eq(schema.song.bandId, band.id),
    eq(schema.song.mediaPrefix, `${band.legacyId}/songs/${songId}`),
    isNull(schema.song.deletedAt),
  ));
  return (row?.config as Record<string, unknown> | undefined) ?? null;
}

/** `POST /api/bands/:bandId/songs/:songId/config` */
export async function authorizeConfigSave(req: CoreRequest): Promise<void> {
  const band = await bandByLegacyId(req.params.bandId);
  const before = await storedConfig(band, req.params.songId);
  await requireCapabilities(req.actor, band, configSaveCapabilities(before, (req.body ?? {}) as Record<string, unknown>));
}

/** `POST /api/bands/:bandId/songs/discography` — adding a song is `song.create`. */
export async function authorizeDiscographyUpsert(req: CoreRequest): Promise<void> {
  const band = await bandByLegacyId(req.params.bandId);
  const id = String((req.body as { id?: unknown } | undefined)?.id ?? '');
  const exists = id !== '' && (await storedConfig(band, id)) !== null;
  await requireCapabilities(req.actor, band, [exists ? 'song.content.write' : 'song.create']);
}

const SCORE_FILE = /\.(mxl|musicxml|xml|mscz)$/i;

/** `POST /api/r2/presign` — scores need `song.score.write`, anything else is audio. */
export async function authorizePresign(req: CoreRequest): Promise<void> {
  const { bandId, files } = (req.body ?? {}) as { bandId?: string; files?: string[] };
  if (!bandId) throw new HttpError(400, 'bandId is required');
  const band = await bandByLegacyId(bandId);
  const caps = new Set<Capability>();
  for (const f of files ?? []) caps.add(SCORE_FILE.test(f) ? 'song.score.write' : 'song.audio.write');
  await requireCapabilities(req.actor, band, caps.size ? [...caps] : ['song.audio.write']);
}

/**
 * `PUT /api/bands/:bandId` — editing needs `band.settings`. Any signed-in
 * user may create a band, and owns it (see `mirrorWrite`).
 */
export async function authorizeBandPut(req: Pick<CoreRequest, 'params' | 'actor'>): Promise<void> {
  await authorizeBandOrNew(req);
}

/** `POST /api/bands/:bandId/logo` — a new band's logo is uploaded before its band.json exists. */
export async function authorizeLogo(req: Pick<CoreRequest, 'params' | 'actor'>): Promise<void> {
  await authorizeBandOrNew(req);
}

/** `band.settings` in an existing band; a band that doesn't exist yet, anyone signed in. */
async function authorizeBandOrNew(req: Pick<CoreRequest, 'params' | 'actor'>): Promise<void> {
  const actor = requireActor(req.actor);
  // A deleted band's id stays claimed: its row still holds the legacy id.
  const [existing] = await db().select({ id: schema.band.id }).from(schema.band)
    .where(eq(schema.band.legacyId, req.params.bandId));
  if (!existing) return;
  await requireCapabilities(actor, await bandByLegacyId(req.params.bandId), ['band.settings']);
}
