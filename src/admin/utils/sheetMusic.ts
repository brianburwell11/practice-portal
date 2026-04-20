/**
 * Helpers for the Add/Edit Song sheet-music uploader. Uploaded files are
 * stored on R2 under a canonical `score.mxl` name (mirroring how stems
 * canonicalize to `${id}.opus`). Plain-XML `.musicxml` / `.xml` inputs
 * are zipped client-side into MXL before upload — MusicXML compresses
 * 20–50× when zipped, which saves a lot of R2 storage and download time.
 *
 * `.mscz` (MuseScore native) can't be converted in the browser — the
 * inner `.mscx` XML is MuseScore's proprietary dialect, not MusicXML.
 * Those files are sent raw to the server, which shells out to the
 * `mscore` CLI to produce `score.mxl` (see `mscz-convert-upload`
 * endpoint in `vite-plugin-config-api.ts`).
 */
import JSZip from 'jszip';

export const SHEET_MUSIC_EXTS = ['musicxml', 'xml', 'mxl', 'mscz'] as const;
export type SheetMusicExt = (typeof SHEET_MUSIC_EXTS)[number];

/** Value for the `<input type="file" accept>` attribute. */
export const SHEET_MUSIC_ACCEPT = '.musicxml,.xml,.mxl,.mscz';

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
 * `null` if the extension isn't a supported sheet-music format. Every
 * supported input — `.musicxml`, `.xml`, `.mxl`, `.mscz` — ultimately
 * lands at `score.mxl` on R2. Plain-XML inputs are zipped client-side,
 * `.mscz` is converted server-side via the `mscore` CLI.
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
 * Result of preparing a picked sheet-music file for upload. The
 * caller uses `mode` to branch between the two upload paths:
 *
 * - `direct`: PUT the `blob` straight to R2 via a presigned URL
 *   (MusicXML/MXL — either passed through or zipped on the fly).
 * - `server-convert`: POST the raw `file` as multipart form-data to
 *   the `/api/r2/mscz-convert-upload/...` endpoint, which shells out
 *   to the `mscore` CLI and uploads the resulting `score.mxl` to R2.
 *
 * In both cases, `filename` is the canonical R2 filename the config's
 * `sheetMusicUrl` should point at (`score.mxl`).
 */
export type PreparedUpload =
  | { mode: 'direct'; blob: Blob; filename: string }
  | { mode: 'server-convert'; file: File; filename: string };

/**
 * Prepares a picked sheet-music file for upload to R2:
 * - `.mxl` → passed through untouched (direct PUT).
 * - `.musicxml` / `.xml` → zipped into a valid MXL archive on the fly
 *   (META-INF/container.xml + score.xml), dramatically reducing size
 *   (direct PUT).
 * - `.mscz` → raw File passed through; caller POSTs it to the
 *   server-side MuseScore-CLI conversion endpoint.
 * - Unsupported extension → `null`.
 */
export async function prepareSheetMusicUpload(
  file: File,
): Promise<PreparedUpload | null> {
  const ext = extOf(file.name);
  if (!isSheetMusicExt(ext)) return null;

  if (ext === 'mscz') {
    // Server-side conversion: the browser can't parse MSCX, so we
    // hand the raw file off to the `mscore` CLI endpoint.
    return { mode: 'server-convert', file, filename: CANONICAL_SHEET_MUSIC_NAME };
  }

  if (ext === 'mxl') {
    return { mode: 'direct', blob: file, filename: CANONICAL_SHEET_MUSIC_NAME };
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
  return { mode: 'direct', blob, filename: CANONICAL_SHEET_MUSIC_NAME };
}
