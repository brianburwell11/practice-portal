/**
 * Helpers for the Add/Edit Song sheet-music uploader. Uploaded files are
 * stored on R2 under a kebab-sanitized version of the user's original
 * filename (e.g. `"Wiggle - SOOZA.mxl"` → `"wiggle-sooza.mxl"`), always
 * with a `.mxl` extension — every supported input ends up as MXL.
 *
 * Plain-XML `.musicxml` / `.xml` inputs are zipped client-side into MXL
 * before upload (MusicXML compresses 20–50× when zipped, which saves a
 * lot of R2 storage and download time).
 *
 * `.mscz` (MuseScore native) can't be converted in the browser — the
 * inner `.mscx` XML is MuseScore's proprietary dialect, not MusicXML.
 * Those files are sent raw to the server, which shells out to the
 * `mscore` CLI to produce the target MXL (see `mscz-convert-upload`
 * endpoint in `vite-plugin-config-api.ts`).
 */
import JSZip from 'jszip';

export const SHEET_MUSIC_EXTS = ['musicxml', 'xml', 'mxl', 'mscz'] as const;
export type SheetMusicExt = (typeof SHEET_MUSIC_EXTS)[number];

/** Value for the `<input type="file" accept>` attribute. */
export const SHEET_MUSIC_ACCEPT = '.musicxml,.xml,.mxl,.mscz';

/** Fallback R2 filename when the user's filename sanitizes to empty. */
const FALLBACK_NAME = 'score.mxl';

/** Max length of the kebab base (before the `.mxl` extension). Keeps R2
 *  keys tidy and bounds the server-side validation regex. */
const MAX_BASE_LEN = 40;

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function baseOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function isSheetMusicExt(ext: string): ext is SheetMusicExt {
  return (SHEET_MUSIC_EXTS as readonly string[]).includes(ext);
}

/** Kebab-sanitize a string: lowercase, non-alphanumerics collapse to a
 *  single hyphen, trim edge hyphens, cap length. Empty result signals
 *  the caller should fall back to a default name. */
function kebab(s: string): string {
  const kebabbed = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return kebabbed.slice(0, MAX_BASE_LEN).replace(/-$/, '');
}

/**
 * Returns the R2 filename for a picked sheet-music file, or `null` if
 * the extension isn't supported. The filename is derived from the
 * user's original (kebab-sanitized) with a `.mxl` extension:
 *
 *   "Wiggle - SOOZA.mxl"        → "wiggle-sooza.mxl"
 *   "My Song (Final).musicxml"  → "my-song-final.mxl"
 *   "🎵.mxl" (empty after kebab) → "score.mxl" (fallback)
 *
 * Every supported input — `.musicxml`, `.xml`, `.mxl`, `.mscz` —
 * ultimately lands on `.mxl` on R2. Plain-XML is zipped client-side;
 * `.mscz` is converted server-side via the `mscore` CLI.
 */
export function canonicalSheetMusicName(file: File): string | null {
  const ext = extOf(file.name);
  if (!isSheetMusicExt(ext)) return null;
  const base = kebab(baseOf(file.name));
  return base ? `${base}.mxl` : FALLBACK_NAME;
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
 *   the `/api/r2/mscz-convert-upload/...` endpoint, passing
 *   `filename` as a `?filename=` query param so the server knows
 *   which R2 key to write under.
 *
 * In both cases, `filename` is the R2 filename (already sanitized)
 * that the config's `sheetMusicUrl` should point at.
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
 *
 * The returned `filename` is a kebab-sanitized version of the user's
 * original filename with a `.mxl` extension.
 */
export async function prepareSheetMusicUpload(
  file: File,
): Promise<PreparedUpload | null> {
  const ext = extOf(file.name);
  if (!isSheetMusicExt(ext)) return null;

  const filename = canonicalSheetMusicName(file)!;

  if (ext === 'mscz') {
    // Server-side conversion: the browser can't parse MSCX, so we
    // hand the raw file off to the `mscore` CLI endpoint.
    return { mode: 'server-convert', file, filename };
  }

  if (ext === 'mxl') {
    return { mode: 'direct', blob: file, filename };
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
  return { mode: 'direct', blob, filename };
}
