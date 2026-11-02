/**
 * AIFF / AIFC reading with no DOM dependencies, so it runs in the audio
 * worker. Chrome's decodeAudioData rejects AIFF, and Live projects are full
 * of it (consolidated and frozen clips are .aif).
 */
import type { Pcm } from './pcm';

export const AIFF_EXTENSIONS = /\.(aif|aiff|aifc)$/i;

/** AIFC compression type of Ableton's encrypted Pack content ("Ableton Content"). */
const ABLETON_PROTECTED = 'able';

/**
 * Whether a file is Ableton Pack audio, which Live encrypts (as AIFC with
 * compression type `able`). Live keeps derived files encrypted too, such as
 * reversed copies in Samples/Processed/Reverse. Only reads the header.
 */
export async function isAbletonProtected(file: File): Promise<boolean> {
  if (!AIFF_EXTENSIONS.test(file.name)) return false;
  const head = await file.slice(0, 64 * 1024).arrayBuffer();
  const view = new DataView(head);
  if (head.byteLength < 12 || fourCC(view, 0) !== 'FORM' || fourCC(view, 8) !== 'AIFC') return false;
  let pos = 12;
  while (pos + 8 <= head.byteLength) {
    const size = view.getUint32(pos + 4);
    if (fourCC(view, pos) === 'COMM') {
      return size >= 22 && pos + 8 + 22 <= head.byteLength && fourCC(view, pos + 8 + 18) === ABLETON_PROTECTED;
    }
    pos += 8 + size + (size % 2);
  }
  return false;
}

/** 80-bit IEEE 754 extended float, as used for AIFF sample rates. */
function readExtended(view: DataView, offset: number): number {
  const exp = view.getUint16(offset) & 0x7fff;
  const hi = view.getUint32(offset + 2);
  const lo = view.getUint32(offset + 6);
  if (exp === 0 && hi === 0 && lo === 0) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

export function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Parse uncompressed AIFF / AIFC. Returns null for anything it can't read. */
export function parseAiffPcm(bytes: ArrayBuffer): Pcm | null {
  const view = new DataView(bytes);
  if (bytes.byteLength < 12 || fourCC(view, 0) !== 'FORM') return null;
  const form = fourCC(view, 8);
  if (form !== 'AIFF' && form !== 'AIFC') return null;

  let channels = 0;
  let frames = 0;
  let bits = 0;
  let sampleRate = 0;
  let compression = 'NONE';
  let dataOffset = -1;

  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const id = fourCC(view, pos);
    const size = view.getUint32(pos + 4);
    const body = pos + 8;
    if (id === 'COMM') {
      channels = view.getUint16(body);
      frames = view.getUint32(body + 2);
      bits = view.getUint16(body + 6);
      sampleRate = readExtended(view, body + 8);
      if (form === 'AIFC' && size >= 22) compression = fourCC(view, body + 18);
    } else if (id === 'SSND') {
      dataOffset = body + 8 + view.getUint32(body);
    }
    pos = body + size + (size % 2);
  }

  const little = compression === 'sowt';
  const float = compression === 'fl32' || compression === 'FL32';
  if (!channels || !frames || !sampleRate || dataOffset < 0) return null;
  if (!['NONE', 'sowt', 'twos', 'fl32', 'FL32'].includes(compression)) return null;
  if (float) bits = 32;
  if (![8, 16, 24, 32].includes(bits)) return null;

  const bytesPer = bits / 8;
  const available = Math.floor((bytes.byteLength - dataOffset) / (bytesPer * channels));
  const length = Math.min(frames, available);
  const out = Array.from({ length: channels }, () => new Float32Array(length));

  let p = dataOffset;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      let v: number;
      if (float) v = view.getFloat32(p, little);
      else if (bits === 16) v = view.getInt16(p, little) / 0x8000;
      else if (bits === 24) {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getUint8(p + 2);
        const raw = little ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        v = (raw & 0x800000 ? raw - 0x1000000 : raw) / 0x800000;
      } else if (bits === 32) v = view.getInt32(p, little) / 0x80000000;
      else v = view.getInt8(p) / 0x80;
      out[c][i] = v;
      p += bytesPer;
    }
  }
  return { sampleRate, channels: out };
}
