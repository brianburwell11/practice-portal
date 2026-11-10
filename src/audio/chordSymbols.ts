/**
 * Chord names as people type them, cleaned up to one spelling.
 *
 * Display only: chords are shown by name (no transpose, no numbers), so this
 * just has to accept the common spellings and store each chord one way:
 * `am7` → `Am7`, `c-7` → `Cm7`, `BbM7` → `Bbmaj7`, `f#ø` → `F#m7b5`,
 * `d/f#` → `D/F#`, `nc` → `N.C.`. Sharps and flats stay as typed.
 */

/** Every quality spelling we accept, mapped to how it's stored. */
const QUALITY_ALIASES: Record<string, string> = {
  '': '', maj: '', M: '', major: '',
  m: 'm', min: 'm', '-': 'm', minor: 'm', mi: 'm',
  dim: 'dim', o: 'dim', '°': 'dim',
  aug: 'aug', '+': 'aug', '+5': 'aug', '#5': 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4',
  '5': '5',
  '6': '6', m6: 'm6', min6: 'm6', '-6': 'm6', '6/9': '6/9', '69': '6/9',
  '7': '7',
  maj7: 'maj7', M7: 'maj7', ma7: 'maj7', Maj7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', j7: 'maj7',
  m7: 'm7', min7: 'm7', '-7': 'm7', mi7: 'm7',
  mmaj7: 'm(maj7)', mMaj7: 'm(maj7)', mM7: 'm(maj7)', 'm(maj7)': 'm(maj7)', '-Δ7': 'm(maj7)',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', min7b5: 'm7b5', '-7b5': 'm7b5',
  dim7: 'dim7', o7: 'dim7', '°7': 'dim7',
  '7sus4': '7sus4', '7sus': '7sus4', '7sus2': '7sus2',
  add9: 'add9', add2: 'add9', '2': 'add9', add11: 'add11',
  '9': '9', maj9: 'maj9', M9: 'maj9', 'Δ9': 'maj9', m9: 'm9', min9: 'm9', '-9': 'm9',
  '11': '11', m11: 'm11', min11: 'm11', '-11': 'm11',
  '13': '13', maj13: 'maj13', m13: 'm13',
  '7b9': '7b9', '7#9': '7#9', '7b5': '7b5', '7#5': '7#5', '7#11': '7#11', '7b13': '7b13',
  '9sus4': '9sus4', '13sus4': '13sus4',
};

const NOTE_RE = /^([A-Ga-g])([#b♯♭]?)$/;

function normalizeNote(raw: string): string | null {
  const m = NOTE_RE.exec(raw);
  if (!m) return null;
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  return m[1].toUpperCase() + acc;
}

/**
 * The stored spelling of a typed chord, or null if it isn't one we know.
 * Whitespace is ignored; the root and bass are capitalized.
 */
export function normalizeChord(input: string): string | null {
  // ♭ and ♯ anywhere (as shown on screen) read as b and #.
  const s = input.replace(/\s+/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
  if (!s) return null;
  if (/^(n\.?c\.?)$/i.test(s)) return 'N.C.';

  // Root, then the quality, then an optional /bass. A lone "b" after the
  // root letter is a flat ("bb" = B flat), never a quality.
  const m = /^([A-Ga-g][#b♯♭]?)(.*?)(?:\/([A-Ga-g][#b♯♭]?))?$/.exec(s);
  if (!m) return null;
  const root = normalizeNote(m[1]);
  if (!root) return null;

  const suffix = m[2];
  // `6/9` contains a slash, so the regex reads "9" as a bass; put it back.
  if (suffix === '6' && m[3] === '9') return `${root}6/9`;
  const quality =
    QUALITY_ALIASES[suffix] ??
    QUALITY_ALIASES[suffix.replace(/[()]/g, '')] ??
    QUALITY_ALIASES[suffix.toLowerCase()] ??
    QUALITY_ALIASES[suffix.toLowerCase().replace(/[()]/g, '')];
  if (quality === undefined) return null;

  let out = root + quality;
  if (m[3]) {
    const bass = normalizeNote(m[3]);
    if (!bass) return null;
    out += `/${bass}`;
  }
  return out;
}

/** Chord names from a typed or pasted progression: a plain list
 *  (`G C | D G`, commas fine) or a ChordPro sheet (`[G]words [C]more`). */
export function chordsFromText(text: string): string[] {
  if (text.includes('[')) return [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
  return text.split(/[\s|,]+/).filter(Boolean);
}

/**
 * A stored chord name as it's shown: real flat and sharp signs (B♭, F♯m7♭5,
 * D/F♯, C7♯9). Display only; names are stored with b and #.
 */
export function displayChord(symbol: string): string {
  return symbol
    .replace(/^([A-G])b/, '$1♭')
    .replace(/^([A-G])#/, '$1♯')
    .replace(/\/([A-G])b/, '/$1♭')
    .replace(/\/([A-G])#/, '/$1♯')
    .replace(/b(?=\d)/g, '♭')
    .replace(/#(?=\d)/g, '♯');
}
