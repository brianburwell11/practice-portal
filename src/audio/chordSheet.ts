import { normalizeChord } from './chordSymbols';

/** One part of a chord sheet, in order. `name` is null before any heading. */
export interface SheetSection {
  name: string | null;
  /** Chord names as stored (normalized), in order, a held chord once. */
  chords: string[];
}

/** A chord to stamp; `section` marks the first chord of a section. */
export interface SheetQueueItem {
  symbol: string;
  section?: string;
}

/** A parsed sheet as Stamp queue items, each section's first chord carrying its name. */
export function sheetToQueue(sheet: ParsedSheet): SheetQueueItem[] {
  return sheet.sections.flatMap((s) =>
    s.chords.map((symbol, i) => (i === 0 && s.name ? { symbol, section: s.name } : { symbol })),
  );
}

export interface ParsedSheet {
  sections: SheetSection[];
  /** Tokens that looked like chords (in [brackets] or on a chord line) but aren't names we know. */
  unknown: string[];
}

/** ChordPro section directives, short and long, to a heading. */
const CHORDPRO_SECTIONS: Record<string, string> = {
  sov: 'Verse', start_of_verse: 'Verse',
  soc: 'Chorus', start_of_chorus: 'Chorus',
  sob: 'Bridge', start_of_bridge: 'Bridge',
  sog: 'Grid', start_of_grid: 'Grid',
  sot: 'Tab', start_of_tab: 'Tab',
  start_of_intro: 'Intro', start_of_outro: 'Outro', start_of_prechorus: 'Pre-chorus',
  start_of_solo: 'Solo', start_of_interlude: 'Interlude',
};

/** Directives that end a section, or carry no chords: skipped. */
const DIRECTIVE_RE = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i;
/** A section heading on its own line: `[Verse 1]`, `[Chorus]`, `Verse:`, `CHORUS`. */
const BRACKET_HEADING_RE = /^\[([^\]]+)\]$/;
// Only short headings ("Verse 2", "Final chorus:", "Chorus (x2)"), so a lyric
// like "Bridge over troubled water" stays a lyric.
const WORD_HEADING_RE = /^(?:(?:final|last|first|double|half)\s+)?(?:intro|verse|pre-?chorus|chorus|bridge|outro|solo|interlude|instrumental|break|hook|coda|refrain|tag|ending|riff)(?:\s*\d+)?(?:\s*\([^)]*\))?\s*:?$/i;
/**
 * A repeat marker: `x4`, `x(4)`, `(x4)`, `[x4]`, `4x`, `(4x)`, `×4`, `*4`.
 * Ultimate Guitar has no rule for what one covers; here it repeats its own
 * line, which is how most sheets use it. On a line of its own, it repeats the
 * chord line above.
 */
const REPEAT_RE = /^[([]?(?:[x×*]\s*\(?(\d+)\)?|(\d+)\s*[x×])[)\]]?$/i;

/** `x 4` and `x (4)` written with a space: close it up so it's one token. */
function joinRepeat(line: string): string {
  return line.replace(/(^|\s)([x×*])\s+(\(?\d+\)?)(?=\s|$)/gi, '$1$2$3');
}
/** Bar and grid symbols that sit among chords and mean nothing on their own. */
const FILLER_RE = /^(\||\|\||\|:|:\||\.|\/|-|–|~|:)+$/;

function isTabLine(line: string): boolean {
  return /^[a-gA-G]?\|?[-0-9hpbrx/\\|~]{6,}/.test(line.replace(/\s/g, ''));
}

/**
 * The chords on a line if it's a chord line (every token is a chord, a bar
 * symbol or a repeat marker), else null. `%` repeats the previous bar.
 */
function chordLine(line: string): { chords: string[]; repeat: number } | null {
  const tokens = joinRepeat(line).replace(/\|/g, ' | ').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const chords: string[] = [];
  let repeat = 1;
  let lastBar: string[] = [];
  let thisBar: string[] = [];
  for (const t of tokens) {
    if (FILLER_RE.test(t)) {
      if (t.includes('|')) {
        if (thisBar.length) lastBar = thisBar;
        thisBar = [];
      }
      continue;
    }
    const rep = REPEAT_RE.exec(t);
    if (rep) {
      repeat = Number(rep[1] ?? rep[2]);
      continue;
    }
    if (t === '%') {
      chords.push(...lastBar);
      thisBar.push(...lastBar);
      continue;
    }
    const name = normalizeChord(t.replace(/^\(|\)$/g, ''));
    if (!name) return null;
    chords.push(name);
    thisBar.push(name);
  }
  return chords.length ? { chords, repeat } : null;
}

/**
 * Read a chord sheet: ChordPro (`[G]` inline, `{start_of_verse}` sections,
 * grids), an Ultimate Guitar–style sheet (chord lines over lyrics, `[Verse]`
 * headings, `x2` repeats), or a plain list (`G Em7 | C D`). Lyrics, tabs,
 * capo and tuning lines are skipped. Timing is never in a sheet: these go to
 * the Stamp queue in order.
 */
export function parseChordSheet(text: string): ParsedSheet {
  const sections: SheetSection[] = [];
  const unknown: string[] = [];
  let current: SheetSection = { name: null, chords: [] };
  /** The last chord line's chords, for a repeat marker on a line of its own. */
  let lastLine: string[] = [];

  const startSection = (name: string | null) => {
    if (current.chords.length > 0 || current.name !== null) sections.push(current);
    current = { name, chords: [] };
  };
  const add = (names: string[]) => {
    for (const n of names) {
      // A held chord (G | G) is one change, not two.
      if (current.chords[current.chords.length - 1] !== n) current.chords.push(n);
    }
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Ultimate Guitar's raw format wraps chords and tabs in [ch]…[/ch], [tab]…[/tab].
    // A repeat marker in brackets ([x4]) isn't a ChordPro chord: unwrap it.
    const line = raw
      .replace(/\[\/?(ch|tab)\]/gi, '')
      .replace(/\[\s*([x×*]\s*\(?\d+\)?|\d+\s*[x×])\s*\]/gi, '$1')
      .trim();
    if (!line || line.startsWith('#')) continue;

    const directive = DIRECTIVE_RE.exec(line);
    if (directive) {
      const key = directive[1].toLowerCase();
      const value = directive[2]?.trim();
      if (CHORDPRO_SECTIONS[key]) startSection(value || CHORDPRO_SECTIONS[key]);
      else if (key === 'c' || key === 'comment' || key === 'ci' || key === 'comment_italic') {
        if (value && WORD_HEADING_RE.test(value)) startSection(value.replace(/:$/, ''));
      }
      continue;
    }

    const heading = BRACKET_HEADING_RE.exec(line);
    if (heading && !normalizeChord(heading[1])) {
      startSection(heading[1].trim());
      continue;
    }
    if (WORD_HEADING_RE.test(line) && !chordLine(line)) {
      startSection(line.replace(/:$/, '').trim());
      continue;
    }
    if (isTabLine(line) || /^(capo|tuning|key|tempo|bpm|time|author|artist|title)\b/i.test(line)) continue;

    // ChordPro: chords in brackets inside the lyrics.
    if (/\[[^\]]+\]/.test(line)) {
      for (const m of line.matchAll(/\[([^\]]+)\]/g)) {
        const name = normalizeChord(m[1]);
        if (name) add([name]);
        else unknown.push(m[1].trim());
      }
      continue;
    }

    // A repeat marker alone: the chord line above plays that many times in all.
    const loneRepeat = REPEAT_RE.exec(joinRepeat(line));
    if (loneRepeat) {
      const times = Number(loneRepeat[1] ?? loneRepeat[2]);
      for (let r = 1; r < times; r++) add(lastLine);
      continue;
    }

    const chords = chordLine(line);
    if (chords) {
      for (let r = 0; r < chords.repeat; r++) add(chords.chords);
      lastLine = chords.chords;
      continue;
    }

    // A chord line with one stray token that looks like a chord (capital A to G)
    // but isn't one we know: keep the rest and report it. Short lyric lines
    // ("Am I…") don't qualify.
    const tokens = line.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    const known = tokens.filter((t) => normalizeChord(t) || FILLER_RE.test(t)).length;
    const strays = tokens.filter((t) => !normalizeChord(t) && !FILLER_RE.test(t));
    if (tokens.length >= 3 && strays.length === 1 && known >= 2 && /^[A-G]/.test(strays[0])) {
      for (const t of tokens) {
        if (FILLER_RE.test(t)) continue;
        const name = normalizeChord(t);
        if (name) add([name]);
        else unknown.push(t);
      }
    }
    // Anything else is lyrics.
  }
  startSection(null);
  return { sections: sections.filter((s) => s.chords.length > 0), unknown };
}
