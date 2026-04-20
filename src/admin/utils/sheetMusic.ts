/**
 * Helpers for the Add/Edit Song sheet-music uploader. Uploaded files are
 * stored on R2 under a canonical `score.{ext}` name (mirroring how stems
 * canonicalize to `${id}.opus`), so replacing a file with the same
 * extension overwrites cleanly.
 */

export const SHEET_MUSIC_EXTS = ['musicxml', 'xml', 'mxl'] as const;
export type SheetMusicExt = (typeof SHEET_MUSIC_EXTS)[number];

/** Value for the `<input type="file" accept>` attribute. */
export const SHEET_MUSIC_ACCEPT = '.musicxml,.xml,.mxl';

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isSheetMusicExt(ext: string): ext is SheetMusicExt {
  return (SHEET_MUSIC_EXTS as readonly string[]).includes(ext);
}

/**
 * Returns the canonical R2 filename (`score.{ext}`) for a picked file, or
 * `null` if the extension isn't a supported MusicXML format.
 */
export function canonicalSheetMusicName(file: File): string | null {
  const ext = extOf(file.name);
  return isSheetMusicExt(ext) ? `score.${ext}` : null;
}
