// @vitest-environment node
/**
 * The encoder must be lossless: every file it writes has to decode, with the
 * reference `flac` and with ffmpeg (what the server uses), to exactly the
 * samples it was given. Those checks need both tools on PATH and are skipped
 * without them (CI); the CRC checks run everywhere.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc16, crc8 } from './flacEncoder';
import { encodeFileToFlac, readPcmLayout } from './encodeFile';

const has = (bin: string) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0
  || spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
const tools = has('ffmpeg') && has('flac');

describe('CRCs', () => {
  const check = new TextEncoder().encode('123456789');
  it('CRC-8 (poly 0x07)', () => expect(crc8(check)).toBe(0xf4));
  it('CRC-16 (poly 0x8005)', () => expect(crc16(check)).toBe(0xfee8));
});

type Gen = (i: number, c: number) => number;

/** Interleaved little- or big-endian integer PCM. */
function pcm(frames: number, channels: number, bits: 16 | 24, gen: Gen, bigEndian = false): Buffer {
  const bps = bits / 8;
  const max = 2 ** (bits - 1) - 1;
  const min = -(2 ** (bits - 1));
  const out = Buffer.alloc(frames * channels * bps);
  let p = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, p += bps) {
      const s = Math.max(min, Math.min(max, Math.round(gen(i, c))));
      if (bits === 16) {
        if (bigEndian) out.writeInt16BE(s, p); else out.writeInt16LE(s, p);
      } else if (bigEndian) {
        out.writeIntBE(s, p, 3);
      } else {
        out.writeIntLE(s, p, 3);
      }
    }
  }
  return out;
}

function wav(data: Buffer, channels: number, rate: number, bits: 16 | 24, extensible = false, extra = 0): Buffer {
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : 1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * (bits / 8), 8);
  fmt.writeUInt16LE(channels * (bits / 8), 12);
  fmt.writeUInt16LE(bits, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bits, 18);
    fmt.writeUInt32LE(0, 20);
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(fmt, 24);
  }
  const chunk = (id: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'ascii');
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  // An odd-sized chunk before the samples, like the metadata DAWs add.
  const junk = extra ? chunk('JUNK', Buffer.alloc(extra, 7)) : Buffer.alloc(0);
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), junk, chunk('data', data)]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function aiff(data: Buffer, channels: number, rate: number, bits: 16 | 24, sowt = false): Buffer {
  const frames = data.length / (channels * (bits / 8));
  const comm = Buffer.alloc(sowt ? 24 : 18);
  comm.writeUInt16BE(channels, 0);
  comm.writeUInt32BE(frames, 2);
  comm.writeUInt16BE(bits, 6);
  // 80-bit extended sample rate.
  const exp = Math.floor(Math.log2(rate));
  comm.writeUInt16BE(16383 + exp, 8);
  comm.writeBigUInt64BE(BigInt(rate) << BigInt(63 - exp), 10);
  if (sowt) comm.write('sowt', 18, 'ascii');
  const chunk = (id: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'ascii');
    h.writeUInt32BE(body.length, 4);
    return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const ssnd = Buffer.concat([Buffer.alloc(8), data]);
  const body = Buffer.concat([Buffer.from(sowt ? 'AIFC' : 'AIFF'), chunk('COMM', comm), chunk('SSND', ssnd)]);
  const head = Buffer.alloc(8);
  head.write('FORM', 0, 'ascii');
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A Blob of a Node Buffer (copied: Blob wants a plain ArrayBuffer behind it). */
const blob = (b: Buffer) => new Blob([new Uint8Array(b)]);

let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;

const sine: Gen = (i, c) => Math.sin(i / (20 + c * 3)) * 0.5;
const cases: { name: string; file: () => Buffer; minRatio?: number }[] = [
  { name: '16-bit mono sine', file: () => wav(pcm(48000, 1, 16, (i, c) => sine(i, c) * 32767), 1, 48000, 16) },
  { name: '24-bit stereo sine, odd length', file: () => wav(pcm(44100 * 2 + 37, 2, 24, (i, c) => sine(i, c) * 8388607), 2, 44100, 24) },
  { name: '24-bit stereo, identical channels', file: () => wav(pcm(20000, 2, 24, (i) => sine(i, 0) * 8e6), 2, 48000, 24) },
  { name: '24-bit stereo, opposite channels', file: () => wav(pcm(20000, 2, 24, (i, c) => (c ? -1 : 1) * sine(i, 0) * 8388607), 2, 48000, 24) },
  { name: '24-bit full-scale white noise', file: () => wav(pcm(30000, 2, 24, () => rand() * 8388608), 2, 48000, 24) },
  { name: '16-bit full-scale square', file: () => wav(pcm(30000, 2, 16, (i) => ((i >> 5) & 1 ? 32767 : -32768)), 2, 48000, 16) },
  { name: '24-bit extremes alternating', file: () => wav(pcm(10000, 2, 24, (i, c) => ((i + c) & 1 ? 8388607 : -8388608)), 2, 48000, 24) },
  { name: 'digital silence', file: () => wav(pcm(50000, 2, 24, () => 0), 2, 48000, 24) },
  { name: 'silence then a click', file: () => wav(pcm(50000, 2, 24, (i) => (i === 30000 ? 8388607 : 0)), 2, 48000, 24) },
  { name: 'quiet noise with DC offset', file: () => wav(pcm(40000, 1, 24, () => 1000 + rand() * 3), 1, 96000, 24) },
  { name: 'WAVE_FORMAT_EXTENSIBLE + JUNK chunk', file: () => wav(pcm(20000, 2, 24, sine), 2, 48000, 24, true, 33) },
  { name: '6 channels', file: () => wav(pcm(20000, 6, 24, (i, c) => sine(i, c) * 4e6 + rand() * 50), 6, 48000, 24) },
  { name: 'AIFF 24-bit big-endian', file: () => aiff(pcm(20000, 2, 24, (i, c) => sine(i, c) * 8e6, true), 2, 44100, 24) },
  { name: 'AIFC sowt 16-bit', file: () => aiff(pcm(20000, 2, 16, (i, c) => sine(i, c) * 30000), 2, 48000, 16, true) },
];

const samples = path.resolve(__dirname, '../../../docs/public/audio-samples');
const realFiles = fs.existsSync(samples)
  ? [...fs.readdirSync(samples), ...fs.readdirSync(path.join(samples, '10s')).map((f) => `10s/${f}`)]
    .filter((f) => f.endsWith('.wav')).map((f) => path.join(samples, f))
  : [];

/** Decoded samples as 32-bit little-endian integers, whatever the file. */
function decode(file: string): Buffer {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

async function roundTrip(input: Buffer, ext: string): Promise<{ ratio: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flac-test-'));
  try {
    const src = path.join(dir, `in${ext}`);
    const out = path.join(dir, 'out.flac');
    fs.writeFileSync(src, input);
    const flac = await encodeFileToFlac(blob(input));
    expect(flac).not.toBeNull();
    fs.writeFileSync(out, Buffer.from(await flac!.arrayBuffer()));

    // The reference decoder accepts it (frame CRCs and all).
    const t = spawnSync('flac', ['-t', '-s', out]);
    expect(t.status, t.stderr.toString()).toBe(0);
    // ffmpeg, which the server uses, gets the identical samples back.
    const a = decode(src);
    const b = decode(out);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    expect(a.equals(b)).toBe(true);
    return { ratio: flac!.size / input.length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!tools)('lossless round trip through flac and ffmpeg', () => {
  for (const c of cases) {
    it(c.name, async () => {
      const file = c.file();
      await roundTrip(file, file.subarray(0, 4).toString() === 'RIFF' ? '.wav' : '.aiff');
    }, 30_000);
  }
  for (const f of realFiles) {
    it(`real stem ${path.basename(f)} is smaller and identical`, async () => {
      const { ratio } = await roundTrip(fs.readFileSync(f), '.wav');
      expect(ratio).toBeLessThan(0.9);
    }, 60_000);
  }
});

describe('formats it leaves alone', () => {
  it('32-bit float WAV', async () => {
    const data = Buffer.alloc(8 * 5000);
    const file = wav(data, 2, 48000, 16);
    file.writeUInt16LE(3, 20); // format tag: IEEE float
    file.writeUInt16LE(32, 34);
    file.writeUInt16LE(8, 32);
    expect(await readPcmLayout(blob(file))).toBeNull();
  });
  it('an MP3', async () => {
    expect(await encodeFileToFlac(blob(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00rest-of-an-mp3')))).toBeNull();
  });
  it('a WAV too short to bother with', async () => {
    expect(await encodeFileToFlac(blob(wav(pcm(100, 1, 16, () => 0), 1, 48000, 16)))).toBeNull();
  });
});
