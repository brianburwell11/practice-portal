import type { MeasureRect } from './museEncoreEngine';

/**
 * Gives each measure of a multi-measure rest its own share of it.
 *
 * MuseScore draws a multi-measure rest as one measure, so the engine reports
 * the same rectangle (and first beat) for every measure it stands for. A
 * cursor then sits on the rest for all but its last measure and races across
 * it in that one. Here a run of measures sharing a rectangle splits it evenly
 * from its first beat to its end, so the cursor moves through the rest one
 * measure at a time. The first measure keeps any header in front of its beat.
 *
 * `rects` and `beats` are indexed by written measure; returns new arrays.
 */
export function splitMultiMeasureRests(
  rects: readonly (MeasureRect | null)[],
  beats: readonly (number | null)[],
): { rects: (MeasureRect | null)[]; beats: (number | null)[] } {
  const outRects = rects.slice();
  const outBeats = beats.slice();
  let i = 0;
  while (i < rects.length) {
    const r = rects[i];
    let end = i + 1;
    if (r) while (end < rects.length && sameRect(rects[end], r)) end++;
    const count = end - i;
    if (r && count > 1) {
      const right = r.x + r.width;
      const beat = beats[i];
      const start = beat != null && beat > r.x && beat < right ? beat : r.x;
      const step = (right - start) / count;
      for (let k = 0; k < count; k++) {
        const x = k === 0 ? r.x : start + k * step;
        const xEnd = start + (k + 1) * step;
        outRects[i + k] = { ...r, x, width: xEnd - x };
        outBeats[i + k] = k === 0 ? beats[i] : x;
      }
    }
    i = end;
  }
  return { rects: outRects, beats: outBeats };
}

function sameRect(a: MeasureRect | null, b: MeasureRect): boolean {
  return !!a && a.page === b.page && a.x === b.x && a.y === b.y && a.width === b.width;
}
