import type { MixerTemplate, SongConfig, StemConfig, StemGroupConfig } from '../audio/types';

/** What a template holds, without its id, name, or default flag. */
export type MixerTemplateMix = Pick<MixerTemplate, 'stems' | 'groups'>;

/** Template names match track names ignoring case and extra spaces. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const clampVolume = (v: number) => Math.max(0, Math.min(1.5, v));
const clampPan = (p: number) => Math.max(-1, Math.min(1, p));

/**
 * The live mix as a template, keyed by track and stack label. A song with two
 * tracks of the same name keeps the first, since applying could only ever
 * give them the same value.
 */
export function captureTemplate(
  song: Pick<SongConfig, 'stems' | 'groups'>,
  stems: Record<string, { volume: number; pan: number } | undefined>,
  groups: Record<string, { volume: number } | undefined>,
): MixerTemplateMix {
  const seenStems = new Set<string>();
  const seenGroups = new Set<string>();
  const out: MixerTemplateMix = { stems: [], groups: [] };
  for (const stem of song.stems) {
    const key = normalizeName(stem.label);
    if (!key || seenStems.has(key)) continue;
    seenStems.add(key);
    out.stems.push({
      name: stem.label.trim(),
      volume: clampVolume(stems[stem.id]?.volume ?? stem.defaultVolume),
      pan: clampPan(stems[stem.id]?.pan ?? stem.defaultPan),
    });
  }
  for (const group of song.groups ?? []) {
    const key = normalizeName(group.label);
    if (!key || seenGroups.has(key)) continue;
    seenGroups.add(key);
    out.groups.push({
      name: group.label.trim(),
      volume: clampVolume(groups[group.id]?.volume ?? group.defaultVolume ?? 1),
    });
  }
  return out;
}

export interface TemplateMatch {
  /** Stem id → the template's gain and pan for it. */
  stems: Map<string, { volume: number; pan: number }>;
  /** Group id → the template's gain for it. */
  groups: Map<string, number>;
  /** Tracks and stacks that matched a template entry. */
  matched: number;
  /** Tracks and stacks in the song. */
  total: number;
}

function byName<T extends { name: string }>(entries: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    if (key && !map.has(key)) map.set(key, entry);
  }
  return map;
}

/** Which of the song's tracks and stacks the template names, and their values. */
export function matchTemplate(template: MixerTemplateMix, song: Pick<SongConfig, 'stems' | 'groups'>): TemplateMatch {
  const stemEntries = byName(template.stems);
  const groupEntries = byName(template.groups);
  const stems = new Map<string, { volume: number; pan: number }>();
  const groups = new Map<string, number>();
  for (const stem of song.stems) {
    const entry = stemEntries.get(normalizeName(stem.label));
    if (entry) stems.set(stem.id, { volume: clampVolume(entry.volume), pan: clampPan(entry.pan) });
  }
  for (const group of song.groups ?? []) {
    const entry = groupEntries.get(normalizeName(group.label));
    if (entry) groups.set(group.id, clampVolume(entry.volume));
  }
  return {
    stems,
    groups,
    matched: stems.size + groups.size,
    total: song.stems.length + (song.groups?.length ?? 0),
  };
}

export interface ApplyFilter {
  /** Only these tracks take the template's values. Default: all. */
  stem?: (stem: StemConfig) => boolean;
  /** Only these stacks take the template's values. Default: all. */
  group?: (group: StemGroupConfig) => boolean;
}

/** The config with the template's values as matched tracks' and stacks' defaults. */
export function applyTemplateToConfig<C extends Pick<SongConfig, 'stems' | 'groups'>>(
  config: C,
  template: MixerTemplateMix,
  filter: ApplyFilter = {},
): C {
  const match = matchTemplate(template, config);
  return {
    ...config,
    stems: config.stems.map((stem) => {
      const m = match.stems.get(stem.id);
      if (!m || (filter.stem && !filter.stem(stem))) return stem;
      return { ...stem, defaultVolume: m.volume, defaultPan: m.pan };
    }),
    ...(config.groups ? {
      groups: config.groups.map((group) => {
        const v = match.groups.get(group.id);
        if (v === undefined || (filter.group && !filter.group(group))) return group;
        return { ...group, defaultVolume: v };
      }),
    } : {}),
  };
}
