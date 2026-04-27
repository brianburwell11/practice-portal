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

const SECTION_RE = new RegExp(
  `^\\s*#(${LYRIC_SECTIONS.join('|')})\\d*\\s*$`,
  'i',
);

const INSTRUMENTAL_RE = /^\s*(?:#instrumental|\[\s*instrumental\s*\])\s*$/i;

const LEGACY_BRACKET_RE = /^\s*\[.*\]\s*$/;

export function isSectionMarker(text: string): boolean {
  return SECTION_RE.test(text);
}

export function isInstrumentalAnnotation(text: string): boolean {
  return INSTRUMENTAL_RE.test(text);
}

export function isLegacyBracketAnnotation(text: string): boolean {
  return LEGACY_BRACKET_RE.test(text);
}

export function isAdminAnnotation(text: string): boolean {
  return isSectionMarker(text) || isLegacyBracketAnnotation(text);
}
