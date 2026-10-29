import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isReservedRoute } from '../../../src/config/reservedRoutes';
import { bandConfigSchema, bandConfigWriteSchema } from '../../../src/config/schema';
import { HttpError, json, ok } from '../http';
import { isNoSuchKey, r2ListKeys, r2PublicUrl, r2PutFile, r2StorageBytes } from '../r2';
import { deleteObject, readJson, writeJson } from '../store';
import type { CoreRequest, CoreResponse } from '../types';

/** Slim per-band entry stored in `registry.json`. */
interface RegistryEntry {
  id: string;
  name: string;
  route: string;
  background: string;
  text: string;
  logo?: string;
}

interface Registry {
  bands: RegistryEntry[];
}

/** Full `band.json`, as validated by `bandConfigSchema`. */
type BandConfig = ReturnType<typeof bandConfigSchema.parse>;

const LOGO_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** Drop the `songIds` field left over from the pre-split registry format. */
function stripLegacyFields(entry: RegistryEntry & { songIds?: unknown }): RegistryEntry {
  const rest = { ...entry };
  delete rest.songIds;
  return rest;
}

function slimEntry(band: BandConfig): RegistryEntry {
  const entry: RegistryEntry = {
    id: band.id,
    name: band.name,
    route: band.route,
    background: band.colors.background,
    text: band.colors.text,
  };
  if (band.logo) entry.logo = band.logo;
  return entry;
}

/**
 * Read `registry.json`, treating any read failure as "doesn't exist yet".
 * The parsed object is returned as-is (minus a normalized `bands`) so callers
 * that write it back preserve any unrecognized top-level keys.
 */
async function readRegistry(): Promise<{ registry: Registry; existed: boolean }> {
  try {
    const registry = await readJson<Registry>('registry.json');
    registry.bands = registry.bands ?? [];
    return { registry, existed: true };
  } catch {
    return { registry: { bands: [] }, existed: false };
  }
}

export async function uploadBandLogo(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const file = req.files?.[0];
  if (!file) throw new HttpError(400, 'No file in upload');

  const ext = path.extname(file.filename).toLowerCase() || '.png';
  const contentType = LOGO_CONTENT_TYPES[ext] ?? 'application/octet-stream';

  // A new name for every upload: a replaced logo shows at once everywhere,
  // with no browser or CDN cache holding the old one. The name never gets
  // new content, so it can be cached for good. `putBand` deletes the old one.
  const key = `${bandId}/assets/logo-${randomBytes(6).toString('hex')}${ext}`;
  await r2PutFile(key, fs.readFileSync(file.path), contentType, 'public, max-age=31536000, immutable');

  return ok({ path: `${r2PublicUrl()}/${key}` });
}

/** Upsert a single band: authoritative `band.json` plus its registry entry. */
export async function putBand(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const validated = bandConfigWriteSchema.parse(req.body);

  if (validated.id !== bandId) {
    throw new HttpError(400, `URL band id "${bandId}" doesn't match body id "${validated.id}"`);
  }

  // A route the site keeps for its own pages can't be claimed — by a new
  // band, or by renaming one. A band already sitting on one keeps it.
  if (isReservedRoute(validated.route)) {
    let currentRoute: string | undefined;
    try {
      currentRoute = (await readJson<{ route: string }>(`${bandId}/band.json`)).route;
    } catch (err) {
      if (!isNoSuchKey(err)) throw err;
    }
    if (currentRoute !== validated.route) {
      throw new HttpError(400, `"${validated.route}" is reserved for the site — pick another route`);
    }
  }

  // Every band, Members-only ones included: the caller may not see the band
  // already at this address, but it's still taken.
  const { registry, existed } = await readRegistry();
  if (registry.bands.some((b) => b.id !== bandId && b.route === validated.route)) {
    throw new HttpError(400, `"${validated.route}" is already taken. Pick another address.`);
  }

  // The logo it had, to delete if this save replaces or removes it.
  let previousLogo: string | undefined;
  try {
    previousLogo = (await readJson<{ logo?: string }>(`${bandId}/band.json`)).logo;
  } catch (err) {
    if (!isNoSuchKey(err)) throw err;
  }

  // 1. Write the authoritative per-band file.
  await writeJson(`${bandId}/band.json`, validated);

  // An old uploaded logo nothing points at any more. Only this band's own
  // uploads, never another URL someone pasted in.
  const ownLogos = `${r2PublicUrl()}/${bandId}/assets/logo`;
  if (previousLogo && previousLogo !== validated.logo && previousLogo.startsWith(ownLogos)) {
    await deleteObject(previousLogo.slice(`${r2PublicUrl()}/`.length));
  }

  // 2. Upsert the slim entry in registry.json.
  const isNewBand = !existed || !registry.bands.some((b) => b.id === bandId);

  registry.bands = registry.bands
    .filter((b) => b.id !== bandId)
    .map(stripLegacyFields);
  registry.bands.push(slimEntry(validated));
  await writeJson('registry.json', registry);

  // 3. Seed blank setlists index for a new band.
  if (isNewBand) {
    try {
      await readJson<unknown>(`${bandId}/setlists/index.json`);
    } catch {
      await writeJson(`${bandId}/setlists/index.json`, { setlists: [] });
    }
  }

  return ok();
}

export async function deleteBand(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;

  // 1. Delete all R2 keys under the band's prefix (songs, setlists, assets, etc.)
  try {
    const keys = await r2ListKeys(`${bandId}/`);
    for (const key of keys) {
      try {
        await deleteObject(key);
      } catch {
        // individual key failure shouldn't abort the cascade
      }
    }
  } catch {
    // prefix may be empty
  }

  // 2. Remove band from registry.json (and strip any legacy songIds fields)
  try {
    const registry = await readJson<Registry>('registry.json');
    registry.bands = (registry.bands ?? [])
      .filter((b) => b.id !== bandId)
      .map(stripLegacyFields);
    await writeJson('registry.json', registry);
  } catch {
    // registry may not exist
  }

  return ok();
}

export async function bandStorage(req: CoreRequest): Promise<CoreResponse> {
  const { totalBytes, objectCount } = await r2StorageBytes(`${req.params.bandId}/`);
  return json({ totalBytes, objectCount });
}

