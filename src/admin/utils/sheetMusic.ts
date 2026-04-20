/**
 * Helpers for the Add/Edit Song sheet-music uploader. Uploaded files are
 * stored on R2 under a canonical `score.mxl` name (mirroring how stems
 * canonicalize to `${id}.opus`). Plain-XML `.musicxml` / `.xml` inputs
 * are zipped client-side into MXL before upload — MusicXML compresses
 * 20–50× when zipped, which saves a lot of R2 storage and download time.
 */
import JSZip from 'jszip';

export const SHEET_MUSIC_EXTS = ['musicxml', 'xml', 'mxl'] as const;
export type SheetMusicExt = (typeof SHEET_MUSIC_EXTS)[number];

/** Value for the `<input type="file" accept>` attribute. */
export const SHEET_MUSIC_ACCEPT = '.musicxml,.xml,.mxl';

/** Canonical R2 filename for any supported sheet-music upload. */
export const CANONICAL_SHEET_MUSIC_NAME = 'score.mxl';

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isSheetMusicExt(ext: string): ext is SheetMusicExt {
  return (SHEET_MUSIC_EXTS as readonly string[]).includes(ext);
}

/**
 * Returns the canonical R2 filename (`score.mxl`) for a picked file, or
 * `null` if the extension isn't a supported MusicXML format. Every
 * supported input — `.musicxml`, `.xml`, `.mxl` — lands at `score.mxl`
 * on R2; plain-XML inputs are zipped before upload (see
 * `prepareSheetMusicUpload`).
 */
export function canonicalSheetMusicName(file: File): string | null {
  const ext = extOf(file.name);
  return isSheetMusicExt(ext) ? CANONICAL_SHEET_MUSIC_NAME : null;
}

/**
 * META-INF/container.xml — the MXL pointer file that tells readers
 * (OSMD, MuseScore, etc.) where the MusicXML root is inside the archive.
 * Content must be exact per the MusicXML 4.0 spec.
 */
const MXL_CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>
`;

/**
 * Prepares a picked sheet-music file for upload to R2:
 * - `.mxl` → passed through untouched.
 * - `.musicxml` / `.xml` → zipped into a valid MXL archive on the fly
 *   (META-INF/container.xml + score.xml), dramatically reducing size.
 * - Unsupported extension → `null` (caller falls back the same way as
 *   before).
 *
 * Returns the upload blob and the canonical filename
 * (`score.mxl`) the caller should presign + PUT under.
 */
export async function prepareSheetMusicUpload(
  file: File,
): Promise<{ blob: Blob; filename: string } | null> {
  const ext = extOf(file.name);
  if (!isSheetMusicExt(ext)) return null;

  if (ext === 'mxl') {
    return { blob: file, filename: CANONICAL_SHEET_MUSIC_NAME };
  }

  // Plain-XML MusicXML — zip it. JSZip default deflate is fine; OSMD reads
  // standard ZIPs (no need for the "stored first-entry" optimization that
  // the MusicXML spec's appendix describes).
  const xmlText = await file.text();
  const zip = new JSZip();
  zip.file('META-INF/container.xml', MXL_CONTAINER_XML);
  zip.file('score.xml', xmlText);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.recordare.musicxml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { blob, filename: CANONICAL_SHEET_MUSIC_NAME };
}
