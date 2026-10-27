import { setlistConfigSchema } from '../../../src/config/schema';
import { ok } from '../http';
import { deleteObject, readJson, writeJson } from '../store';
import type { CoreRequest, CoreResponse } from '../types';

interface SetlistIndex {
  setlists: { id: string; slug?: string; name: string }[];
}

/** Read `<band>/setlists/index.json`, treating a read failure as empty. */
async function readIndex(bandId: string): Promise<SetlistIndex> {
  try {
    return await readJson<SetlistIndex>(`${bandId}/setlists/index.json`);
  } catch {
    // index doesn't exist yet
    return { setlists: [] };
  }
}

export async function saveSetlist(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, setlistId } = req.params;
  const validated = setlistConfigSchema.parse(req.body);

  await writeJson(`${bandId}/setlists/${setlistId}.json`, validated);

  // Update setlist index
  const index = await readIndex(bandId);
  index.setlists = index.setlists.filter((s) => s.id !== setlistId);
  index.setlists.push({
    id: setlistId,
    ...(validated.slug ? { slug: validated.slug } : {}),
    name: validated.name,
  });
  await writeJson(`${bandId}/setlists/index.json`, index);

  return ok();
}

export async function deleteSetlist(req: CoreRequest): Promise<CoreResponse> {
  const { bandId, setlistId } = req.params;

  await deleteObject(`${bandId}/setlists/${setlistId}.json`);

  const index = await readIndex(bandId);
  index.setlists = index.setlists.filter((s) => s.id !== setlistId);
  await writeJson(`${bandId}/setlists/index.json`, index);

  return ok();
}
