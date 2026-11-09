/**
 * A fader's linear gain as decibels, the way Logic labels it: `-∞`, `-6.0`,
 * `0.0`, `+3.5`. Exact for a stem's own fader, which `StemPlayer` applies
 * directly as gain (`gain = volume × groupVolume`).
 */
export function formatDb(gain: number): string {
  if (!(gain > 0)) return '-∞';
  const db = Math.round(20 * Math.log10(gain) * 10) / 10;
  if (db === 0) return '0.0'; // also catches -0
  return db > 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
}

/**
 * A typed dB value as linear gain, or null if it isn't one. Accepts `-6`,
 * `+3.5`, `-6 dB`, `-inf` / `-∞`. Clamped to the fader's range (0 to
 * `maxGain`); anything at or below -100 dB is silence.
 */
export function parseDb(text: string, maxGain: number): number | null {
  const t = text.trim().toLowerCase().replace(/\s*db$/, '');
  if (/^-?(∞|inf(inity)?)$/.test(t)) return 0;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const db = Number(t);
  if (db <= -100) return 0;
  return Math.min(maxGain, 10 ** (db / 20));
}
