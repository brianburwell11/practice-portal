import { Inflate } from 'fflate';

/**
 * Reads the MusicXML out of an `.mxl` (zipped MusicXML) without trusting the
 * archive. Scores come from uploads, so a crafted file could otherwise:
 * - declare thousands of entries (slow to walk, memory for each),
 * - inflate a few KB into gigabytes (a zip bomb) and crash the tab,
 * - lie about sizes in its headers to get past a size check.
 *
 * So: the central directory is read and checked first (entry count, declared
 * sizes), only the one score entry is inflated, and inflation stops as soon as
 * the real output passes the limit, whatever the header said.
 */

export interface ZipLimits {
  /** Most entries an archive may list. Real .mxl files have 2-10. */
  maxEntries: number;
  /** Largest decompressed score XML, in bytes. */
  maxEntryBytes: number;
  /** Largest compressed archive, in bytes. */
  maxArchiveBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 64,
  maxEntryBytes: 20 * 1024 * 1024,
  maxArchiveBytes: 50 * 1024 * 1024,
};

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeArchiveError';
  }
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
/** Inflate in slices so an oversized entry is stopped early, not after the fact.
 *  Deflate expands at most ~1032:1, so one slice yields at most ~16 MB. */
const CHUNK = 16 * 1024;

/** True when the bytes start like a zip archive (`PK`). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function listEntries(bytes: Uint8Array, limits: ZipLimits): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: 22 bytes plus a comment of up to 64 KB, at the end.
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new UnsafeArchiveError('Not a valid MXL file (no zip directory)');

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === ZIP64_MARKER) {
    throw new UnsafeArchiveError('MXL files over 4 GB (zip64) are not supported');
  }
  if (count > limits.maxEntries) {
    throw new UnsafeArchiveError(`MXL file has too many entries (${count})`);
  }
  if (cdOffset + cdSize > eocd) throw new UnsafeArchiveError('Corrupt MXL file');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== CDH_SIG) {
      throw new UnsafeArchiveError('Corrupt MXL file');
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    if (p + 46 + nameLen > eocd) throw new UnsafeArchiveError('Corrupt MXL file');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(bytes: Uint8Array, entry: ZipEntry, limits: ZipLimits): Uint8Array {
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new UnsafeArchiveError('Score in MXL file is too large');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lh = entry.localHeaderOffset;
  if (lh + 30 > bytes.length || view.getUint32(lh, true) !== LFH_SIG) {
    throw new UnsafeArchiveError('Corrupt MXL file');
  }
  const dataStart = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) throw new UnsafeArchiveError('Corrupt MXL file');
  const data = bytes.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    if (data.length > limits.maxEntryBytes) throw new UnsafeArchiveError('Score in MXL file is too large');
    return data.slice();
  }
  if (entry.method !== 8) throw new UnsafeArchiveError('Unsupported compression in MXL file');

  // Count real output, not the header's claim.
  const out: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limits.maxEntryBytes) { tooLarge = true; return; }
    out.push(chunk);
  });
  for (let i = 0; i < data.length && !tooLarge; i += CHUNK) {
    const end = Math.min(i + CHUNK, data.length);
    inflater.push(data.subarray(i, end), end === data.length);
  }
  if (tooLarge) throw new UnsafeArchiveError('Score in MXL file is too large');

  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of out) { result.set(c, offset); offset += c.length; }
  return result;
}

/** The score's path inside the archive, from `META-INF/container.xml`. */
function rootFilePath(containerXml: string): string | null {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  return doc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
}

/**
 * The MusicXML text inside an `.mxl` archive, checked against `limits`.
 * Throws `UnsafeArchiveError` for anything oversized, corrupt or unexpected.
 */
export function extractMusicXml(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): string {
  if (bytes.length > limits.maxArchiveBytes) throw new UnsafeArchiveError('MXL file is too large');
  const entries = listEntries(bytes, limits);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const decoder = new TextDecoder('utf-8');

  let scoreEntry: ZipEntry | undefined;
  const container = byName.get('META-INF/container.xml');
  if (container) {
    const path = rootFilePath(decoder.decode(readEntry(bytes, container, limits)));
    if (path) scoreEntry = byName.get(path);
  }
  scoreEntry ??= entries.find((e) => /\.(xml|musicxml)$/i.test(e.name) && !e.name.startsWith('META-INF/'));
  if (!scoreEntry) throw new UnsafeArchiveError('No score inside MXL file');

  return decoder.decode(readEntry(bytes, scoreEntry, limits));
}

/**
 * The entries of an archive whose names pass `accept`, inflated under
 * `limits` (per entry) and `maxTotalBytes` (all of them together). Entries
 * that don't pass `accept` are never inflated.
 */
export function extractEntries(
  bytes: Uint8Array,
  accept: (name: string) => boolean,
  maxTotalBytes: number,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Map<string, Uint8Array> {
  if (bytes.length > limits.maxArchiveBytes) throw new UnsafeArchiveError('Score file is too large');
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (const entry of listEntries(bytes, limits)) {
    if (entry.name.endsWith('/') || !accept(entry.name)) continue;
    // Check the declared size first so an obvious bomb is refused before inflating.
    if (total + entry.uncompressedSize > maxTotalBytes) throw new UnsafeArchiveError('Score file is too large');
    const data = readEntry(bytes, entry, limits);
    total += data.length;
    if (total > maxTotalBytes) throw new UnsafeArchiveError('Score file is too large');
    out.set(entry.name, data);
  }
  return out;
}

/**
 * Score bytes (zipped `.mxl` or plain MusicXML) to MusicXML text, with the
 * same size limits for both.
 */
export function scoreBytesToXml(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): string {
  if (isZip(bytes)) return extractMusicXml(bytes, limits);
  if (bytes.length > limits.maxEntryBytes) throw new UnsafeArchiveError('Score file is too large');
  return new TextDecoder('utf-8').decode(bytes);
}
