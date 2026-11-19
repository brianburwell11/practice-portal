import type { TapMapEntry } from './types';

/**
 * Going back within this many seconds of a start skips to the one before,
 * so pressing back twice walks back instead of landing on the same bar.
 */
const BACK_GRACE_SEC = 0.75;

/** Without a beat map, the arrow keys move this far. */
export const STEP_SEC = 5;

/** Start times of every bar in the beat map (sections start bars too), in order. */
export function barStarts(tapMap: TapMapEntry[] | undefined): number[] {
  return (tapMap ?? [])
    .filter((e) => e.type === 'section' || e.type === 'measure')
    .map((e) => e.time)
    .sort((a, b) => a - b);
}

/** Start times of every section in the beat map, in order. */
export function sectionStarts(tapMap: TapMapEntry[] | undefined): number[] {
  return (tapMap ?? [])
    .filter((e) => e.type === 'section')
    .map((e) => e.time)
    .sort((a, b) => a - b);
}

/**
 * Where a step back (`-1`) or ahead (`1`) from `position` lands among
 * `starts`. Back goes to the start of the current one, or the one before
 * when already at its start; before the first, the song's start. Ahead
 * goes to the next start, or null when there's none.
 */
export function stepTarget(starts: number[], position: number, dir: -1 | 1): number | null {
  if (dir > 0) return starts.find((t) => t > position + 0.05) ?? null;
  let target = 0;
  for (const t of starts) {
    if (t < position - BACK_GRACE_SEC) target = t;
    else break;
  }
  return target;
}
