/**
 * What to do when a waiting edit reaches the server and someone else saved
 * the same document meanwhile (a 409). Three copies: `base` (what the edit
 * started from), `mine` (the edit) and `theirs` (the server's now).
 *
 * - Song config: a whole object of independent parts (timing, mix, markers).
 *   Each top-level key is merged on its own: mine where I changed it, theirs
 *   otherwise. Only a key both sides changed, differently, is a conflict.
 * - Lyrics and chords: one piece of writing each, so mine goes through only
 *   if theirs is still the base.
 */

/** How a document is merged. */
export type MergeKind = 'config' | 'whole';

export type Resolution =
  /** Send this (based on theirs). */
  | { type: 'resend'; data: unknown }
  /** The server already has it (theirs is mine, or what mine merges to). */
  | { type: 'done' }
  /** Ask. `keys`: for config, the parts both sides changed. */
  | { type: 'conflict'; keys?: string[] };

export function mergeKindOf(key: string): MergeKind {
  return key.endsWith('/config.json') ? 'config' : 'whole';
}

/** JSON with object keys sorted, so key order never counts as a change. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  }) ?? 'undefined';
}

export function sameDoc(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Merge config key by key. Returns the merged config, or the keys in conflict. */
export function mergeConfig(
  base: Record<string, unknown>, mine: Record<string, unknown>, theirs: Record<string, unknown>,
): { ok: true; merged: Record<string, unknown> } | { ok: false; keys: string[] } {
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)]);
  const merged: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const k of keys) {
    const mineChanged = !sameDoc(base[k], mine[k]);
    const theirsChanged = !sameDoc(base[k], theirs[k]);
    if (mineChanged && theirsChanged && !sameDoc(mine[k], theirs[k])) conflicts.push(k);
    const value = mineChanged ? mine[k] : theirs[k];
    if (value !== undefined) merged[k] = value;
  }
  return conflicts.length > 0 ? { ok: false, keys: conflicts.sort() } : { ok: true, merged };
}

/** Decide what a 409 means for a waiting edit. `base` undefined: not known. */
export function resolveConflict(kind: MergeKind, base: unknown, mine: unknown, theirs: unknown): Resolution {
  if (sameDoc(mine, theirs)) return { type: 'done' };
  if (base === undefined) return { type: 'conflict' };
  if (kind === 'config') {
    if (!isObject(base) || !isObject(mine) || !isObject(theirs)) return { type: 'conflict' };
    const result = mergeConfig(base, mine, theirs);
    if (!result.ok) return { type: 'conflict', keys: result.keys };
    return sameDoc(result.merged, theirs) ? { type: 'done' } : { type: 'resend', data: result.merged };
  }
  return sameDoc(theirs, base) ? { type: 'resend', data: mine } : { type: 'conflict' };
}

/** Plain names for the parts of a song's config, for the conflict dialog. */
const PART_NAMES: Record<string, string> = {
  tapMap: 'timing (beat map)',
  tempoMap: 'tempo',
  timeSignatureMap: 'time signatures',
  beatOffset: 'beat offset',
  markers: 'markers',
  stems: 'mix and stems',
  groups: 'stacks',
  mixerOrder: 'mixer order',
  metronome: 'metronome',
  videos: 'videos',
  navLinks: 'links',
  audioOffsetSeconds: 'audio offset',
};

export function partName(key: string): string {
  return PART_NAMES[key] ?? key;
}
