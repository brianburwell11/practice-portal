import type { StemConfig, StemGroupConfig } from './types';

export type MixerOrderItem<S = StemConfig, G = StemGroupConfig> =
  | { kind: 'group'; id: string; group: G }
  | { kind: 'stem'; id: string; stem: S };

interface OrderableSong<S, G> {
  stems: S[];
  groups?: G[];
  mixerOrder?: string[];
}

/**
 * Build the top-level mixer display order for a song. Honors
 * `song.mixerOrder` when present (filtered against the actual
 * stems/groups; unknown IDs are dropped), and appends any items
 * not mentioned there using the legacy default of "groups first,
 * then ungrouped stems."
 *
 * Stems that belong to a group are NOT included at the top level —
 * they appear nested under their group in the mixer.
 *
 * The shapes are loose so the same util works for both saved
 * SongConfigs and the admin wizard's in-progress state.
 */
export function resolveMixerOrder<
  S extends { id: string },
  G extends { id: string; stemIds: string[] }
>(song: OrderableSong<S, G> | null | undefined): MixerOrderItem<S, G>[] {
  if (!song) return [];
  const groups = song.groups ?? [];
  const stems = song.stems ?? [];

  const groupById = new Map(groups.map((g) => [g.id, g] as const));
  const stemById = new Map(stems.map((s) => [s.id, s] as const));

  const groupedStemIds = new Set<string>();
  for (const g of groups) for (const sid of g.stemIds) groupedStemIds.add(sid);

  const result: MixerOrderItem<S, G>[] = [];
  const placed = new Set<string>();

  for (const id of song.mixerOrder ?? []) {
    if (placed.has(id)) continue;
    const g = groupById.get(id);
    if (g) {
      result.push({ kind: 'group', id, group: g });
      placed.add(id);
      continue;
    }
    const s = stemById.get(id);
    if (s && !groupedStemIds.has(id)) {
      result.push({ kind: 'stem', id, stem: s });
      placed.add(id);
    }
  }

  // Append anything missing, preserving today's default: groups first,
  // then ungrouped stems.
  for (const g of groups) {
    if (!placed.has(g.id)) {
      result.push({ kind: 'group', id: g.id, group: g });
      placed.add(g.id);
    }
  }
  for (const s of stems) {
    if (groupedStemIds.has(s.id)) continue;
    if (!placed.has(s.id)) {
      result.push({ kind: 'stem', id: s.id, stem: s });
      placed.add(s.id);
    }
  }

  return result;
}
