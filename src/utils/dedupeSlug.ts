/** Returns `base` if it's not already in `taken`, otherwise appends
 *  `-1`, `-2`, ... until a free slug is found. Pass an empty set when
 *  there's nothing to dedupe against (always returns `base`). */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  if (!base) return base;
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  let n = 1;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
