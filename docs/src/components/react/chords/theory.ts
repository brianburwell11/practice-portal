/**
 * Tiny chord-symbol toolkit for the chord docs widgets. Not the app's parser
 * (that would be `chord-symbol`), just enough to show the ideas: forgiving
 * input, one canonical spelling, transpose, simplify, Nashville and Roman.
 */

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Canonical quality → intervals (semitones above the root). */
export const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  '11': [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
};

/** Every spelling people type, mapped to the canonical quality. */
const ALIASES: Record<string, string> = {
  '': '', maj: '', M: '', major: '',
  m: 'm', min: 'm', '-': 'm', minor: 'm', mi: 'm',
  dim: 'dim', o: 'dim', '°': 'dim',
  aug: 'aug', '+': 'aug', '+5': 'aug', '#5': 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4',
  '5': '5',
  '6': '6', m6: 'm6', min6: 'm6', '-6': 'm6',
  '7': '7', dom7: '7',
  maj7: 'maj7', M7: 'maj7', ma7: 'maj7', Maj7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', t7: 'maj7', j7: 'maj7',
  m7: 'm7', min7: 'm7', '-7': 'm7', mi7: 'm7',
  mmaj7: 'mMaj7', mMaj7: 'mMaj7', mM7: 'mMaj7', 'm(maj7)': 'mMaj7', '-Δ7': 'mMaj7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', '0': 'm7b5', 'min7b5': 'm7b5', '-7b5': 'm7b5',
  dim7: 'dim7', o7: 'dim7', '°7': 'dim7',
  '7sus4': '7sus4', '7sus': '7sus4',
  add9: 'add9', add2: 'add9', '2': 'add9',
  '9': '9', maj9: 'maj9', M9: 'maj9', 'Δ9': 'maj9', m9: 'm9', min9: 'm9', '-9': 'm9',
  '11': '11', m11: 'm11', min11: 'm11', '-11': 'm11',
  '13': '13', '7b9': '7b9', '7#9': '7#9',
};

export interface Chord {
  root: number;
  quality: string;
  bass: number | null;
  /** True for N.C. (no chord). */
  nc?: boolean;
  /** How the root and bass were spelled when typed, kept until transposed. */
  rootFlat?: boolean;
  bassFlat?: boolean;
}

function parseNote(s: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return (pc + 12) % 12;
}

/** Parse anything a person might type. Returns null if it isn't a chord. */
export function parseChord(input: string): Chord | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(n\.?c\.?|nc)$/i.test(s)) return { root: 0, quality: '', bass: null, nc: true };
  const m = /^([A-Ga-g])([#b♯♭]?)(.*?)(?:\/([A-Ga-g][#b♯♭]?))?$/.exec(s);
  if (!m) return null;
  const root = parseNote(m[1] + m[2]);
  if (root === null) return null;
  const raw = m[3];
  const bare = raw.replace(/[()]/g, '');
  let quality = ALIASES[raw] ?? ALIASES[bare];
  if (quality === undefined) quality = ALIASES[bare.toLowerCase()];
  if (quality === undefined) return null;
  const bass = m[4] ? parseNote(m[4]) : null;
  const isFlat = (acc: string | undefined) => acc === 'b' || acc === '♭' ? true : acc === '#' || acc === '♯' ? false : undefined;
  return { root, quality, bass, rootFlat: isFlat(m[2]), bassFlat: isFlat(m[4]?.slice(1)) };
}

/** Major keys (and their relative minors) that read better in flats. */
const FLAT_KEYS = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb

export type Spelling = 'auto' | 'sharps' | 'flats';

export function noteName(pc: number, keyPc: number, spelling: Spelling = 'auto'): string {
  const p = ((pc % 12) + 12) % 12;
  const flats = spelling === 'flats' || (spelling === 'auto' && FLAT_KEYS.has(((keyPc % 12) + 12) % 12));
  return (flats ? FLATS : SHARPS)[p];
}

export type Simplify = 'full' | 'seventh' | 'triad';

export function simplifyQuality(q: string, level: Simplify): string {
  if (level === 'full') return q;
  const minor = q.startsWith('m') && !q.startsWith('maj') && q !== 'mMaj7';
  if (level === 'triad') {
    if (q === 'dim' || q === 'dim7' || q === 'm7b5') return q === 'm7b5' ? 'm' : 'dim';
    if (q === 'aug') return 'aug';
    if (q.startsWith('sus') || q === '7sus4') return 'sus4';
    if (q === '5') return '5';
    return minor || q === 'mMaj7' ? 'm' : '';
  }
  // seventh
  if (['maj9', 'maj7'].includes(q)) return 'maj7';
  if (['m9', 'm11', 'm7'].includes(q)) return 'm7';
  if (['9', '11', '13', '7b9', '7#9', '7'].includes(q)) return '7';
  if (q === 'add9') return '';
  if (q === '6') return '';
  if (q === 'm6') return 'm';
  return q;
}

export interface FormatOpts {
  /** Semitones to move the sounding chord. */
  transpose?: number;
  /** Capo fret: shapes are written this many semitones below the sound. */
  capo?: number;
  /** Key of the stored chords (pitch class). */
  keyPc?: number;
  /** `keyPc` is a minor tonic: number from it on the natural minor scale
   *  (Am: C = 3, not b3). Leave false to number a minor key from its
   *  relative major (Am = 6m), the usual Nashville habit. */
  minorTonic?: boolean;
  spelling?: Spelling;
  simplify?: Simplify;
  notation?: 'letters' | 'nashville' | 'roman';
}

const NASH = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const NASH_MINOR = ['1', 'b2', '2', '3', '#3', '4', '#4', '5', '6', '#6', '7', '#7'];
const ROMAN_MINOR = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'];

function nashQuality(q: string, roman: boolean): { text: string; lower: boolean } {
  if (!roman) {
    if (q === 'm') return { text: 'm', lower: false };
    return { text: q, lower: false };
  }
  if (q === 'm') return { text: '', lower: true };
  if (q === 'm7') return { text: '7', lower: true };
  if (q === 'm9') return { text: '9', lower: true };
  if (q === 'dim') return { text: '°', lower: true };
  if (q === 'dim7') return { text: '°7', lower: true };
  if (q === 'm7b5') return { text: 'ø7', lower: true };
  if (q.startsWith('m') && !q.startsWith('maj')) return { text: q.slice(1), lower: true };
  return { text: q, lower: false };
}

/** Render a chord with every display setting applied. The stored chord is untouched. */
export function formatChord(c: Chord, o: FormatOpts = {}): string {
  if (c.nc) return 'N.C.';
  const shift = (o.transpose ?? 0) - (o.capo ?? 0);
  const keyPc = (o.keyPc ?? 0) + shift;
  const q = simplifyQuality(c.quality, o.simplify ?? 'full');
  const keepBass = (o.simplify ?? 'full') !== 'triad';
  if (o.notation === 'nashville' || o.notation === 'roman') {
    const roman = o.notation === 'roman';
    const deg = (c.root - (o.keyPc ?? 0) + 120) % 12;
    const nq = nashQuality(q, roman);
    const nums = o.minorTonic ? NASH_MINOR : NASH;
    let head = (roman ? (o.minorTonic ? ROMAN_MINOR : ROMAN) : nums)[deg];
    if (roman && nq.lower) head = head.toLowerCase();
    let out = head + nq.text;
    if (keepBass && c.bass !== null) out += '/' + nums[(c.bass - (o.keyPc ?? 0) + 120) % 12];
    return out;
  }
  // Untransposed, keep the spelling the person typed (Bb stays Bb in G).
  const asTyped = (flat: boolean | undefined): Spelling =>
    shift === 0 && (o.spelling ?? 'auto') === 'auto' && flat !== undefined ? (flat ? 'flats' : 'sharps') : o.spelling ?? 'auto';
  let out = noteName(c.root + shift, keyPc, asTyped(c.rootFlat)) + q;
  if (keepBass && c.bass !== null) out += '/' + noteName(c.bass + shift, keyPc, asTyped(c.bassFlat));
  return out;
}

/** Canonical stored spelling: letters, untransposed. */
export function canonical(input: string, keyPc = 7): string | null {
  const c = parseChord(input);
  return c ? formatChord(c, { keyPc }) : null;
}

/** MIDI note numbers for a chord, voiced around middle C with the bass an octave down. */
export function chordMidi(c: Chord): number[] {
  if (c.nc) return [];
  const iv = QUALITIES[c.quality] ?? QUALITIES[''];
  const base = 60 + ((c.root + 12 - 5) % 12) - 7; // root between F3 and E4
  const notes = iv.map((i) => base + (i > 12 ? i - 12 : i));
  const bassPc = c.bass ?? c.root;
  notes.unshift(36 + ((bassPc + 12 - 4) % 12)); // bass between E2 and D#3
  return notes;
}
