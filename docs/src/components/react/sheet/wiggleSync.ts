/**
 * Beat ↔ time conversion using the Wiggle tapMap (sparse list of beat onsets
 * recorded by tapping while the audio plays). Mirrors the production logic in
 * `src/audio/tempoUtils.ts` but reads from the docs-side config JSON.
 *
 * The tapMap has entries like `{time: 4.064, type: 'measure'}` and
 * `{time: 4.549, type: 'beat'}`. Both count as one quarter-note step. We
 * filter to beat+measure entries and assign monotonically increasing beat
 * numbers — beat 0 is the first tap.
 */

export interface WiggleTap {
  time: number;
  type: 'beat' | 'measure' | 'section';
  label?: string;
}

export interface WiggleConfig {
  id: string;
  title: string;
  durationSeconds: number;
  tempoMap: Array<{ beat: number; bpm: number }>;
  tapMap: WiggleTap[];
  markers: Array<{ name: string; beat: number; color: string }>;
}

/** Build a (audio-seconds → score-beat) lookup table from the tapMap. */
export interface BeatTime {
  beat: number;     // sequential beat index, 0-based
  seconds: number;  // audio-seconds at which this beat sounds
}

export function buildBeatTimes(config: WiggleConfig): BeatTime[] {
  const out: BeatTime[] = [];
  let beat = 0;
  for (const tap of config.tapMap) {
    if (tap.type === 'beat' || tap.type === 'measure') {
      out.push({ beat, seconds: tap.time });
      beat++;
    }
  }
  return out;
}

/**
 * Convert audio-seconds → score-beat by interpolating between adjacent
 * tap entries. Falls back to the nominal BPM (from tempoMap) before the
 * first tap or after the last.
 */
export function secondsToBeat(
  seconds: number,
  beatTimes: BeatTime[],
  fallbackBpm = 120,
): number {
  if (beatTimes.length === 0) return (seconds / 60) * fallbackBpm;
  if (seconds <= beatTimes[0].seconds) {
    // Pre-first-tap: extrapolate at fallback BPM
    return Math.max(0, (seconds - beatTimes[0].seconds) / 60 * fallbackBpm);
  }
  if (seconds >= beatTimes[beatTimes.length - 1].seconds) {
    const last = beatTimes[beatTimes.length - 1];
    return last.beat + ((seconds - last.seconds) / 60) * fallbackBpm;
  }
  // Binary search for the bracketing pair
  let lo = 0;
  let hi = beatTimes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (beatTimes[mid].seconds <= seconds) lo = mid;
    else hi = mid;
  }
  const a = beatTimes[lo];
  const b = beatTimes[hi];
  const frac = (seconds - a.seconds) / (b.seconds - a.seconds);
  return a.beat + frac * (b.beat - a.beat);
}

/** Inverse: beat → seconds. */
export function beatToSeconds(
  beat: number,
  beatTimes: BeatTime[],
  fallbackBpm = 120,
): number {
  if (beatTimes.length === 0) return (beat / fallbackBpm) * 60;
  if (beat <= beatTimes[0].beat) return beatTimes[0].seconds + ((beat - beatTimes[0].beat) / fallbackBpm) * 60;
  if (beat >= beatTimes[beatTimes.length - 1].beat) {
    const last = beatTimes[beatTimes.length - 1];
    return last.seconds + ((beat - last.beat) / fallbackBpm) * 60;
  }
  let lo = 0;
  let hi = beatTimes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (beatTimes[mid].beat <= beat) lo = mid;
    else hi = mid;
  }
  const a = beatTimes[lo];
  const b = beatTimes[hi];
  const frac = (beat - a.beat) / (b.beat - a.beat);
  return a.seconds + frac * (b.seconds - a.seconds);
}

/**
 * Some Wiggle reality: the audio has ~2.3 seconds of pickup before the score's
 * first downbeat. The score's beat 0 corresponds to the *first tap* in the
 * tapMap, not audio-time-zero. This helper centralizes that shift so callers
 * can subtract the audio offset before mapping to score beats.
 */
export function audioOffsetSeconds(config: WiggleConfig): number {
  const firstTap = config.tapMap.find((t) => t.type === 'measure' || t.type === 'beat');
  return firstTap?.time ?? 0;
}

/**
 * The audio-time of every measure/section downbeat in tapMap order.
 * Index k is the k-th measure of the score (measureIndex = k, assuming the
 * tapMap's first measure-tap is aligned with OSMD measure 0).
 */
export function measureStartTimes(config: WiggleConfig): number[] {
  return config.tapMap
    .filter((t) => t.type === 'measure' || t.type === 'section')
    .map((t) => t.time);
}

/**
 * Given audio time, return the 0-based index of the current measure by
 * finding the largest measureStartTime ≤ seconds. Clamps to 0 during any
 * pickup/count-in before the first measure-tap, and to the last measure
 * after the final measure-tap.
 */
export function currentMeasureIndex(seconds: number, measureTimes: number[]): number {
  if (measureTimes.length === 0) return 0;
  if (seconds < measureTimes[0]) return 0;
  if (seconds >= measureTimes[measureTimes.length - 1]) return measureTimes.length - 1;
  let lo = 0;
  let hi = measureTimes.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (measureTimes[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  return lo;
}
