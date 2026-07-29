import { setlistConfigSchema } from '../../../src/config/schema';
import { ok } from '../http';
import { r2DeleteKey, r2ReadJson, r2WriteJson } from '../r2';
import type { CoreRequest, CoreResponse } from '../types';

interface SetlistIndex {
  setlists: { id: string; slug?: string; name: string }[];
}

/** Read `<band>/setlists/index.json`, treating a read failure as empty. */
async function readIndex(bandId: string): Promise<SetlistIndex> {
  try {
    return await r2ReadJson<SetlistIndex>(`${bandId}/setlists/index.json`);
  } catch {
    // index doesn't exist yet
    return { setlists: [] };
  }
}

export async function saveSetlist(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, setlistId } = req.params;
  const validated = setlistConfigSchema.parse(req.body);

  await r2WriteJson(`${bandId}/setlists/${setlistId}.json`, validated);

  // Update setlist index
  const index = await readIndex(bandId);
  index.setlists = index.setlists.filter((s) => s.id !== setlistId);
  index.setlists.push({
    id: setlistId,
    ...(validated.slug ? { slug: validated.slug } : {}),
    name: validated.name,
  });
  await r2WriteJson(`${bandId}/setlists/index.json`, index);

  return ok();
}

export async function deleteSetlist(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, setlistId } = req.params;

  await r2DeleteKey(`${bandId}/setlists/${setlistId}.json`);

  const index = await readIndex(bandId);
  index.setlists = index.setlists.filter((s) => s.id !== setlistId);
  await r2WriteJson(`${bandId}/setlists/index.json`, index);

  return ok();
}
