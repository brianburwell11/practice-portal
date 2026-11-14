/**
 * WAV / AIFF file → FLAC Blob, read a slice at a time so a 200 MB stem never
 * sits in memory whole. Only integer PCM at 16 or 24 bits is taken: that's
 * what FLAC holds exactly. Anything else (32-bit float, 8-bit, compressed
 * WAVs, MP3, ...) gets `null` and is uploaded as it is.
 */
import { BLOCK_SIZE, BitWriter, canEncode, streamHeader, writeFrame } from './flacEncoder';

export interface PcmLayout {
  sampleRate: number;
  channels: number;
  bitsPerSample: 16 | 24;
  bigEndian: boolean;
  /** Byte offset and length of the sample data. */
  dataOffset: number;
  dataLength: number;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

/** 80-bit IEEE extended (AIFF's sample rate). */
function extended(b: Uint8Array, at: number): number {
  const exponent = ((b[at] & 0x7f) << 8) | b[at + 1];
  let mantissa = 0;
  for (let i = 0; i < 8; i++) mantissa = mantissa * 256 + b[at + 2 + i];
  return mantissa * 2 ** (exponent - 16383 - 63);
}

function pcmBits(bits: number, blockAlign: number, channels: number): 16 | 24 | null {
  if ((bits === 16 || bits === 24) && blockAlign === channels * (bits / 8)) return bits;
  return null;
}

/** Where the samples are in a WAV or AIFF file, or null if it isn't one this can encode. */
export async function readPcmLayout(file: Blob): Promise<PcmLayout | null> {
  const head = await read(file, 0, 12);
  if (head.length < 12) return null;
  const riff = ascii(head, 0) === 'RIFF' && ascii(head, 8) === 'WAVE';
  const form = ascii(head, 0) === 'FORM' && (ascii(head, 8) === 'AIFF' || ascii(head, 8) === 'AIFC');
  if (!riff && !form) return null;
  const aifc = form && ascii(head, 8) === 'AIFC';

  let format: { sampleRate: number; channels: number; bits: 16 | 24; bigEndian: boolean; frames?: number } | null = null;
  let data: { offset: number; length: number } | null = null;

  for (let pos = 12; pos + 8 <= file.size && !(format && data);) {
    const h = await read(file, pos, 8);
    const id = ascii(h, 0);
    const dv = new DataView(h.buffer);
    const size = dv.getUint32(4, riff);
    const body = pos + 8;

    if (riff && id === 'fmt ') {
      const b = await read(file, body, Math.min(size, 40));
      const v = new DataView(b.buffer);
      let tag = v.getUint16(0, true);
      const channels = v.getUint16(2, true);
      const sampleRate = v.getUint32(4, true);
      const blockAlign = v.getUint16(12, true);
      const bits = v.getUint16(14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the subformat GUID's first two bytes.
      if (tag === 0xfffe && b.length >= 26) tag = v.getUint16(24, true);
      const pcm = pcmBits(bits, blockAlign, channels);
      if (tag !== 1 || !pcm) return null;
      format = { sampleRate, channels, bits: pcm, bigEndian: false };
    } else if (riff && id === 'data') {
      // A size of 0 or 0xFFFFFFFF means "to the end of the file" (written while recording).
      const length = size === 0 || size === 0xffffffff ? file.size - body : Math.min(size, file.size - body);
      data = { offset: body, length };
    } else if (form && id === 'COMM') {
      const b = await read(file, body, Math.min(size, 22));
      const v = new DataView(b.buffer);
      const channels = v.getUint16(0, false);
      const frames = v.getUint32(2, false);
      const bits = v.getUint16(6, false);
      const sampleRate = extended(b, 8);
      let bigEndian = true;
      if (aifc) {
        const compression = ascii(b, 18);
        if (compression === 'sowt') bigEndian = false;
        else if (compression !== 'NONE') return null;
      }
      const pcm = pcmBits(bits, channels * Math.ceil(bits / 8), channels);
      if (!pcm) return null;
      format = { sampleRate, channels, bits: pcm, bigEndian, frames };
    } else if (form && id === 'SSND') {
      const b = await read(file, body, 8);
      const offset = new DataView(b.buffer).getUint32(0, false);
      const start = body + 8 + offset;
      data = { offset: start, length: Math.min(size - 8 - offset, file.size - start) };
    } else if (id === 'ds64') {
      return null; // RF64: over 4 GB, never a stem we take
    }
    pos = body + size + (size & 1);
  }

  if (!format || !data) return null;
  const { sampleRate, channels, bits, bigEndian } = format;
  if (!canEncode({ sampleRate, channels, bitsPerSample: bits })) return null;
  const frameBytes = channels * (bits / 8);
  let length = data.length - (data.length % frameBytes);
  if (format.frames !== undefined) length = Math.min(length, format.frames * frameBytes);
  if (length <= 0) return null;
  return { sampleRate, channels, bitsPerSample: bits, bigEndian, dataOffset: data.offset, dataLength: length };
}

/** Frames read from the file per slice: 64 FLAC blocks, about 1.5 MB of 24-bit stereo. */
const BLOCKS_PER_READ = 64;

/**
 * Encode a WAV/AIFF as FLAC. Resolves to null when the file isn't a format
 * this takes, or is too short to bother with.
 */
export async function encodeFileToFlac(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Blob | null> {
  const layout = await readPcmLayout(file);
  if (!layout) return null;
  const { channels, bitsPerSample: bps, bigEndian } = layout;
  const bytesPerSample = bps / 8;
  const frameBytes = channels * bytesPerSample;
  const totalSamples = layout.dataLength / frameBytes;
  if (totalSamples < BLOCK_SIZE) return null;

  const parts: BlobPart[] = [streamHeader({ sampleRate: layout.sampleRate, channels, bitsPerSample: bps, totalSamples }) as Uint8Array<ArrayBuffer>];
  const block = Array.from({ length: channels }, () => new Int32Array(BLOCK_SIZE));
  let frameNumber = 0;

  for (let done = 0; done < totalSamples;) {
    const count = Math.min(BLOCK_SIZE * BLOCKS_PER_READ, totalSamples - done);
    const bytes = await read(file, layout.dataOffset + done * frameBytes, count * frameBytes);
    if (bytes.length < count * frameBytes) throw new Error('The file ended early');
    const w = new BitWriter(count * frameBytes + 1024);

    for (let first = 0; first < count; first += BLOCK_SIZE) {
      const n = Math.min(BLOCK_SIZE, count - first);
      let p = first * frameBytes;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < channels; c++, p += bytesPerSample) {
          let s: number;
          if (bps === 16) {
            s = bigEndian ? (bytes[p] << 8) | bytes[p + 1] : bytes[p] | (bytes[p + 1] << 8);
            s = (s << 16) >> 16;
          } else {
            s = bigEndian
              ? (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]
              : bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
            s = (s << 8) >> 8;
          }
          block[c][i] = s;
        }
      }
      writeFrame(w, block, n, bps, frameNumber++);
    }
    parts.push(w.bytes().slice() as Uint8Array<ArrayBuffer>);
    done += count;
    onProgress?.(done / totalSamples);
  }
  return new Blob(parts, { type: 'audio/flac' });
}
