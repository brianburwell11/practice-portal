/**
 * Chord names as people type them, cleaned up to one spelling.
 *
 * Display only: chords are shown by name (no transpose, no numbers), so this
 * just has to accept the spellings found on lead sheets, in iReal Pro,
 * MuseScore and Ultimate Guitar, and store each chord one way:
 * `am7` → `Am7`, `c-7` → `Cm7`, `BbM7` → `Bbmaj7`, `f#ø` → `F#m7b5`,
 * `C+7` → `C7#5`, `C7(b9,#11)` → `C7b9#11`, `C^7` → `Cmaj7`,
 * `d/f#` → `D/F#`, `nc` → `N.C.`. Sharps and flats stay as typed.
 *
 * A name is a root, then a quality (m, dim, aug, ø, maj), an extension
 * (5, 6, 6/9, 7, 9, 11, 13), then any of sus, alterations (b5 #5 b6 b9 #9
 * #11 b13), adds, alt and no3/no5, in any order, and an optional /bass.
 * The stored spelling puts them in that order, alterations by degree.
 */

type Quality = '' | 'm' | 'dim' | 'aug' | 'hdim' | '5';

interface Parts {
  quality: Quality;
  /** The highest stacked degree: '', '6', '6/9', '7', '9', '11', '13'. */
  ext: string;
  /** A major seventh (maj7, m(maj7), maj7#5). */
  major7: boolean;
  sus: '' | 'sus2' | 'sus4';
  /** Altered degrees, e.g. 'b9', '#11'. */
  alts: Set<string>;
  /** Added natural degrees: '9', '11', '13'. */
  adds: Set<string>;
  omits: Set<string>;
  alt: boolean;
}

const ALT_ORDER = ['b5', '#5', 'b6', 'b9', '#9', '#11', 'b13'];
const ALT_DEGREES = new Set(['5', '6', '9', '11', '13']);
const EXTENSIONS = ['13', '11', '69', '9', '7', '6', '5', '4', '2'];
const DEGREE_RANK: Record<string, number> = { '': 0, '6': 6, '6/9': 6, '7': 7, '9': 9, '11': 11, '13': 13 };

const NOTE_RE = /^([A-Ga-g])([#b♯♭]?)$/;

function normalizeNote(raw: string): string | null {
  const m = NOTE_RE.exec(raw);
  if (!m) return null;
  const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
  return m[1].toUpperCase() + acc;
}

/** Reads `s` from `i` with each matcher in turn; null if one can't. */
class Cursor {
  readonly s: string;
  i = 0;
  constructor(s: string) { this.s = s; }
  get done() { return this.i >= this.s.length; }
  /** Separators between parts: brackets, commas, slashes. */
  skip() { while (!this.done && '(),/'.includes(this.s[this.i])) this.i++; }
  /** Case-insensitive word match. */
  word(...words: string[]): string | null {
    const rest = this.s.slice(this.i).toLowerCase();
    for (const w of words) if (rest.startsWith(w)) { this.i += w.length; return w; }
    return null;
  }
  /** Case-sensitive match. */
  exact(...tokens: string[]): string | null {
    const rest = this.s.slice(this.i);
    for (const t of tokens) if (rest.startsWith(t)) { this.i += t.length; return t; }
    return null;
  }
  peekDigit() { return /\d/.test(this.s[this.i] ?? ''); }
}

/** A major-seventh marker: maj, M, ma7, Δ, ^, j7. Alone, maj and M mean a
 *  plain major chord and Δ and ^ mean maj7. */
function readMajor(c: Cursor): 'word' | 'symbol' | null {
  if (c.word('major', 'maj')) return 'word';
  if (c.exact('M')) return 'word';
  const save = c.i;
  if (c.word('ma')) {
    if (c.peekDigit()) return 'word';
    c.i = save;
    return null;
  }
  if (c.exact('Δ', '∆', '^')) return 'symbol';
  if (c.exact('j') && c.peekDigit()) return 'symbol';
  c.i = save;
  return null;
}

function readExtension(c: Cursor): string | null {
  for (const e of EXTENSIONS) if (c.exact(e)) return e;
  return null;
}

function parseSuffix(suffix: string): Parts | null {
  const p: Parts = {
    quality: '', ext: '', major7: false, sus: '',
    alts: new Set(), adds: new Set(), omits: new Set(), alt: false,
  };
  const c = new Cursor(suffix);

  // Quality. Lowercase m is minor and uppercase M major, so these are exact.
  // maj comes first, or its m would read as minor.
  const start = c.i;
  if (readMajor(c)) c.i = start;
  else if (c.word('minor', 'min') || c.exact('mi', 'm', '-')) p.quality = 'm';
  else if (c.word('dim') || c.exact('o', '°', 'º')) p.quality = 'dim';
  else if (c.word('aug') || c.exact('+')) p.quality = 'aug';
  else if (c.exact('ø', 'Ø')) { p.quality = 'hdim'; p.ext = '7'; }

  // A major seventh after the quality: maj7, m(maj7), +maj7, CΔ.
  c.skip();
  const major = readMajor(c);
  if (major) {
    const ext = readExtension(c);
    if (ext && ['7', '9', '11', '13'].includes(ext)) { p.major7 = true; p.ext = ext; }
    else if (ext) return null;
    else if (major === 'symbol') { p.major7 = true; p.ext = '7'; }
    else if (p.quality !== '') return null; // "Cmmaj" with no number
  } else {
    const ext = readExtension(c);
    if (ext === '69') p.ext = '6/9';
    else if (ext === '5') {
      // C+5 is just Caug; otherwise 5 is a power chord.
      if (p.quality !== 'aug') { if (p.quality !== '') return null; p.quality = '5'; }
    }
    else if (ext === '2') { if (p.quality !== '' && p.quality !== 'm') return null; p.adds.add('9'); }
    else if (ext === '4') { if (p.quality !== '') return null; p.sus = 'sus4'; }
    else if (ext) p.ext = ext;
  }

  // Everything else, in any order.
  for (;;) {
    c.skip();
    if (c.done) break;
    let tok: string | null;
    if ((tok = c.word('sus2', 'sus4', 'sus'))) {
      const sus = tok === 'sus2' ? 'sus2' : 'sus4';
      if (p.sus && p.sus !== sus) return null;
      p.sus = sus;
      continue;
    }
    if (c.word('add')) {
      const acc = c.exact('b', '#', '+', '-');
      const n = c.exact('13', '11', '9', '6', '4', '2');
      if (!n) return null;
      if (acc) p.alts.add((acc === '+' || acc === '#' ? '#' : 'b') + n);
      else if (n === '6') { if (p.ext) return null; p.ext = '6'; }
      else if (p.ext === '6' && (n === '9' || n === '2')) p.ext = '6/9';
      else p.adds.add(n === '2' ? '9' : n === '4' ? '11' : n);
      continue;
    }
    if (c.word('alt')) { p.alt = true; continue; }
    if ((tok = c.word('no', 'omit'))) {
      const n = c.exact('3', '5');
      if (!n) return null;
      p.omits.add(n);
      continue;
    }
    // C7M, a Brazilian spelling of Cmaj7.
    if (c.s[c.i] === 'M' && !/\d/.test(c.s[c.i + 1] ?? '')) {
      if (p.ext !== '7' || p.major7) return null;
      c.i++;
      p.major7 = true;
      continue;
    }
    if ((tok = c.exact('b', '#', '+', '-'))) {
      const n = c.exact('13', '11', '9', '6', '5');
      const sharp = tok === '#' || tok === '+';
      if (n) { p.alts.add((sharp ? '#' : 'b') + n); continue; }
      if (tok === '+') { p.alts.add('#5'); continue; } // C7+
      return null;
    }
    // A bare tension, as in C7(9) or C6(9).
    if ((tok = c.exact('13', '11', '9'))) {
      if (p.ext === '6') { if (tok !== '9') return null; p.ext = '6/9'; }
      else if (DEGREE_RANK[p.ext] >= 7) { if (DEGREE_RANK[tok] > DEGREE_RANK[p.ext]) p.ext = tok; }
      else p.adds.add(tok);
      continue;
    }
    return null;
  }
  return p;
}

function format(p: Parts): string | null {
  for (const a of p.alts) if (!ALT_DEGREES.has(a.slice(1)) || !ALT_ORDER.includes(a)) return null;
  let quality = p.quality;
  const alts = new Set(p.alts);
  let ext = p.ext;
  if (p.alt && !ext) ext = '7';

  if (quality === '5') {
    if (ext || p.sus || alts.size || p.adds.size || p.omits.size || p.alt) return null;
    return '5';
  }
  if (quality === 'hdim') { quality = 'm'; alts.add('b5'); }
  if (quality === 'aug') {
    // Caug stays; anything stacked on it is spelled with #5: C+7 → C7#5.
    if (ext || p.major7) { quality = ''; alts.add('#5'); }
  } else if (quality === '' && !ext && !p.major7 && !p.sus && alts.size === 1 && alts.has('#5')) {
    // C(#5) is Caug.
    quality = 'aug';
    alts.clear();
  }
  if (quality === 'dim' && (ext && ext !== '7')) return null;
  if (quality === 'dim' && alts.has('b5')) alts.delete('b5');
  // m7b5 is stored that way, so a ø is just minor + b5.

  let out = quality === 'aug' ? 'aug' : quality === 'dim' ? 'dim' : quality;
  if (p.major7) out += quality === 'm' || quality === 'dim' ? `(maj${ext})` : `maj${ext}`;
  else out += ext;
  if (p.alt) out += 'alt';
  out += p.sus;
  const altText = ALT_ORDER.filter((a) => alts.has(a)).join('');
  // Right after the root a flat would read as part of the root (Cb5), so bracket it.
  out += altText && out === '' ? `(${altText})` : altText;
  for (const n of ['9', '11', '13']) if (p.adds.has(n)) out += `add${n}`;
  for (const n of ['3', '5']) if (p.omits.has(n)) out += `(no${n})`;
  return out;
}

/**
 * The stored spelling of a typed chord, or null if it isn't one we know.
 * Whitespace is ignored; the root and bass are capitalized.
 */
export function normalizeChord(input: string): string | null {
  // ♭ and ♯ anywhere (as shown on screen) read as b and #; dashes as minus.
  const s = input
    .replace(/\s+/g, '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/[−–]/g, '-');
  if (!s) return null;
  if (/^(n\.?c\.?)$/i.test(s)) return 'N.C.';

  // Root, then the quality, then an optional /bass. A lone "b" after the
  // root letter is a flat ("bb" = B flat), never a quality.
  const m = /^([A-Ga-g][#b]?)(.*?)(?:\/([A-Ga-g][#b]?))?$/.exec(s);
  if (!m) return null;
  const root = normalizeNote(m[1]);
  if (!root) return null;

  const parts = parseSuffix(m[2]);
  const quality = parts && format(parts);
  if (quality == null) return null;

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
