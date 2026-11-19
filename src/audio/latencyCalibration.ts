/**
 * Tap-along latency calibration, Guitar Hero style: a click plays at a
 * steady tempo, the listener taps on what they hear, and the gap between
 * each click and its tap is the delay from the audio clock to the ear (plus
 * the tap's own input delay, which is wanted, since stamping uses the same
 * taps). Pure maths here; the dialog does the audio and the input.
 */

export const CALIBRATION_BPM = 130;
export const CALIBRATION_PERIOD = 60 / CALIBRATION_BPM;
/** Longest run, in seconds */
export const CALIBRATION_MAX_SECONDS = 30;
/** Taps thrown away at the start, while the listener settles into the beat */
export const WARMUP_TAPS = 4;
/** The rolling window the estimate is taken over */
export const WINDOW = 8;
/** Counted taps (after warm-up) needed before the run can end early */
export const MIN_TAPS = 12;
/** Spread under which the window counts as steady, in ms */
export const STABLE_SD_MS = 12;
/** How early a tap can be and still count as on its own click, in ms.
 *  Anything later than this before the next click counts as late for the
 *  previous one, so delays up to about 360 ms read correctly at 130 BPM. */
export const EARLY_LIMIT_MS = 100;

/** The tap's offset from the nearest click it belongs to, in ms. Positive is
 *  late. Wrapped into [-EARLY_LIMIT_MS, period - EARLY_LIMIT_MS). */
export function tapOffsetMs(tapTime: number, firstClickTime: number, period = CALIBRATION_PERIOD): number {
  const periodMs = period * 1000;
  const raw = (tapTime - firstClickTime) * 1000;
  const shifted = raw + EARLY_LIMIT_MS;
  const phase = ((shifted % periodMs) + periodMs) % periodMs;
  return phase - EARLY_LIMIT_MS;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface CalibrationSummary {
  /** Rolling estimate of the delay, in ms, or null before any counted taps */
  estimateMs: number | null;
  /** Spread of the window after outliers are dropped, in ms */
  sdMs: number | null;
  /** Taps counted so far (warm-up excluded) */
  count: number;
  /** Enough steady taps to stop early */
  stable: boolean;
}

/** Summarize the offsets so far (every tap, warm-up included, in order). */
export function summarize(offsets: number[]): CalibrationSummary {
  const counted = offsets.slice(WARMUP_TAPS);
  if (counted.length === 0) return { estimateMs: null, sdMs: null, count: 0, stable: false };

  const window = counted.slice(-WINDOW);
  const med = median(window);
  // Drop stray taps: more than 2.5 median absolute deviations out, with a
  // floor so a very steady window doesn't reject everything slightly off
  const mad = Math.max(median(window.map((x) => Math.abs(x - med))), 4);
  const kept = window.filter((x) => Math.abs(x - med) <= 2.5 * mad);

  const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length);
  const stable = counted.length >= MIN_TAPS && kept.length >= WINDOW - 2 && sd < STABLE_SD_MS;

  return { estimateMs: Math.round(mean), sdMs: Math.round(sd), count: counted.length, stable };
}
