export const LYRIC_SECTIONS = [
  'INTRO',
  'HOOK',
  'VERSE',
  'PRE-CHORUS',
  'CHORUS',
  'BRIDGE',
  'OUTRO',
] as const;

export type LyricSection = (typeof LYRIC_SECTIONS)[number];

// Any `#HEADING` or `[heading]` line is a section marker: a note for the
// editor, never shown in the song view. `#END` and `#INSTRUMENTAL` /
// `[Instrumental]` are checked first and keep their own meanings.
const HEADING_RE = /^\s*(?:#\S.*|\[.*\])\s*$/;

// `[Chorus]`, `[Verse 2]`, `[Pre Chorus]`: the bracket style lyric sites use.
const BRACKET_SECTION_RE = /^\s*\[\s*(intro|hook|verse|pre[\s-]?chorus|chorus|bridge|outro)\s*(\d*)\s*\]\s*$/i;

/** `[Verse 2]` → `#VERSE2`, or null when the line isn't a bracketed section heading. */
export function bracketSectionToMarker(text: string): string | null {
  const m = BRACKET_SECTION_RE.exec(text);
  if (!m) return null;
  const name = m[1].toUpperCase().replace(/^PRE[\s-]?/, 'PRE-');
  return `#${name}${m[2]}`;
}

const INSTRUMENTAL_RE = /^\s*(?:#instrumental|\[\s*instrumental\s*\])\s*$/i;

/** Marks where the lyrics stop: once its time passes, the song view
 *  moves on to a blank line instead of holding the last lyric. */
export const END_MARKER = '#END';
const END_RE = /^\s*#end\s*$/i;

export function isEndMarker(text: string): boolean {
  return END_RE.test(text);
}

export function isSectionMarker(text: string): boolean {
  return HEADING_RE.test(text) && !isEndMarker(text) && !isInstrumentalAnnotation(text);
}

export function isInstrumentalAnnotation(text: string): boolean {
  return INSTRUMENTAL_RE.test(text);
}

export function isAdminAnnotation(text: string): boolean {
  return isSectionMarker(text);
}
