/* ── Camelot wheel key → colour mapping ── */

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, Fb: 4, 'E#': 5, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10,
  B: 11, Cb: 11, 'B#': 0,
};

// semitone → [major camelot#, minor camelot#]
const SEMITONE_TO_CAMELOT: [number, number][] = [
  [8, 5], [3, 12], [10, 7], [5, 2], [12, 9], [7, 4],
  [2, 11], [9, 6], [4, 1], [11, 8], [6, 3], [1, 10],
];

const CAMELOT_HUE: Record<number, number> = {
  1: 50, 2: 80, 3: 120, 4: 155, 5: 180, 6: 200,
  7: 225, 8: 260, 9: 295, 10: 330, 11: 0, 12: 25,
};

export function getCamelotStyle(raw: string): { bg: string; color: string } | null {
  const trimmed = raw.trim();

  // Match Camelot codes like "8B", "12A"
  const cam = trimmed.match(/^(\d{1,2})([ABab])$/);
  if (cam) {
    const h = CAMELOT_HUE[parseInt(cam[1], 10)];
    if (h !== undefined) return { bg: `hsl(${h} 50% 25%)`, color: `hsl(${h} 70% 80%)` };
  }

  // Match key names like "C", "Bbm", "F# minor"
  const m = trimmed.match(/^([A-Ga-g])\s*([#♯b♭]?)[\s-]*(flat|sharp)?\s*(m|min|minor|M|maj|major)?$/i);
  if (!m) return null;

  let acc = m[2];
  if (m[3]) acc = m[3].toLowerCase() === 'flat' ? 'b' : '#';
  else if (acc === '♯') acc = '#';
  else if (acc === '♭') acc = 'b';

  const semi = NOTE_TO_SEMITONE[m[1].toUpperCase() + acc];
  if (semi === undefined) return null;

  const minor = m[4] ? /^(m|min|minor)$/i.test(m[4]) : false;
  const h = CAMELOT_HUE[SEMITONE_TO_CAMELOT[semi][minor ? 1 : 0]];
  return { bg: `hsl(${h} 50% 25%)`, color: `hsl(${h} 70% 80%)` };
}
