import fs from 'node:fs';
import path from 'node:path';
import { bandConfigSchema } from '../../../src/config/schema';
import { HttpError, json, ok } from '../http';
import {
  r2DeleteKey,
  r2ListKeys,
  r2PublicUrl,
  r2PutFile,
  r2ReadJson,
  r2StorageBytes,
  r2WriteJson,
} from '../r2';
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
    const registry = await r2ReadJson<Registry>('registry.json');
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

  const key = `${bandId}/assets/logo${ext}`;
  await r2PutFile(key, fs.readFileSync(file.path), contentType, 'public, max-age=86400');

  return ok({ path: `${r2PublicUrl()}/${key}` });
}

/** Upsert a single band: authoritative `band.json` plus its registry entry. */
export async function putBand(req: CoreRequest): Promise<CoreResponse> {
  const bandId = req.params.bandId;
  const validated = bandConfigSchema.parse(req.body);

  if (validated.id !== bandId) {
    throw new HttpError(400, `URL band id "${bandId}" doesn't match body id "${validated.id}"`);
  }

  // 1. Write the authoritative per-band file.
  await r2WriteJson(`${bandId}/band.json`, validated);

  // 2. Upsert the slim entry in registry.json.
  const { registry, existed } = await readRegistry();
  const isNewBand = !existed || !registry.bands.some((b) => b.id === bandId);

  registry.bands = registry.bands
    .filter((b) => b.id !== bandId)
    .map(stripLegacyFields);
  registry.bands.push(slimEntry(validated));
  await r2WriteJson('registry.json', registry);

  // 3. Seed blank setlists index for a new band.
  if (isNewBand) {
    try {
      await r2ReadJson<unknown>(`${bandId}/setlists/index.json`);
    } catch {
      await r2WriteJson(`${bandId}/setlists/index.json`, { setlists: [] });
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
        await r2DeleteKey(key);
      } catch {
        // individual key failure shouldn't abort the cascade
      }
    }
  } catch {
    // prefix may be empty
  }

  // 2. Remove band from registry.json (and strip any legacy songIds fields)
  try {
    const registry = await r2ReadJson<Registry>('registry.json');
    registry.bands = (registry.bands ?? [])
      .filter((b) => b.id !== bandId)
      .map(stripLegacyFields);
    await r2WriteJson('registry.json', registry);
  } catch {
    // registry may not exist
  }

  return ok();
}

export async function bandStorage(req: CoreRequest): Promise<CoreResponse> {
  const { totalBytes, objectCount } = await r2StorageBytes(`${req.params.bandId}/`);
  return json({ totalBytes, objectCount });
}

/** (Re)build the slim `registry.json` from the per-band `band.json` files. */
export async function rebuildRegistry(): Promise<CoreResponse> {
  const { registry: oldRegistry } = await readRegistry();

  const bandIds: string[] = Array.from(new Set(oldRegistry.bands.map((b) => b.id)));
  const slim: RegistryEntry[] = [];

  for (const id of bandIds) {
    let full: BandConfig;
    try {
      full = await r2ReadJson<BandConfig>(`${id}/band.json`);
    } catch {
      // Seed band.json from the old (pre-split) registry entry if it
      // still has full color data. After this runs once, subsequent
      // rebuilds read straight from band.json.
      const old = oldRegistry.bands.find((b) => b.id === id) as (RegistryEntry & { colors?: BandConfig['colors'] }) | undefined;
      if (!old?.colors) continue;
      full = {
        id: old.id,
        name: old.name,
        route: old.route,
        colors: old.colors,
      };
      if (old.logo) full.logo = old.logo;
      await r2WriteJson(`${id}/band.json`, full);
    }

    slim.push(slimEntry(full));
  }

  await r2WriteJson('registry.json', { bands: slim });
  return ok({ count: slim.length });
}
