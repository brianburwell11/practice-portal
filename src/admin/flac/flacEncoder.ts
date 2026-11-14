/**
 * A small, lossless FLAC encoder for stem uploads. Raw WAVs are the slow part
 * of adding a song; FLAC carries exactly the same samples in roughly half the
 * bytes, and the server's ffmpeg decodes it back to those same samples before
 * it transcodes to Opus, so the finished file doesn't change.
 *
 * It does what `flac -2` or so does: fixed predictors (orders 0–4), the
 * cheapest of independent / left-side / side-right / mid-side stereo per
 * frame, and partitioned Rice coding of the residual. No LPC: that's a few
 * percent smaller, and much more code to get right.
 *
 * Format reference: RFC 9639 (https://www.rfc-editor.org/rfc/rfc9639).
 */

export const BLOCK_SIZE = 4096;
/** Partition orders tried for the residual (2^8 = 256 partitions at most). */
const MAX_PARTITION_ORDER = 8;
const MAX_FIXED_ORDER = 4;

export interface StreamInfo {
  sampleRate: number;
  channels: number;
  /** 16 or 24. */
  bitsPerSample: number;
  totalSamples: number;
}

/** True when the encoder can take this format. */
export function canEncode(info: Omit<StreamInfo, 'totalSamples'>): boolean {
  return (info.bitsPerSample === 16 || info.bitsPerSample === 24)
    && info.channels >= 1 && info.channels <= 8
    && Number.isInteger(info.sampleRate) && info.sampleRate > 0 && info.sampleRate < 2 ** 20;
}

// ---------------------------------------------------------------- bits

export class BitWriter {
  private buf: Uint8Array;
  private pos = 0;
  private acc = 0;
  private accBits = 0;

  constructor(capacity = 1 << 16) {
    this.buf = new Uint8Array(capacity);
  }

  get byteLength(): number {
    return this.pos;
  }

  private grow(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Write the low `n` bits of a non-negative `value`, most significant first. */
  bits(value: number, n: number): void {
    if (n === 0) return;
    if (n > 24) {
      this.bits(Math.floor(value / 0x1000000), n - 24);
      this.bits(value % 0x1000000, 24);
      return;
    }
    this.acc = (this.acc << n) | (value & ((1 << n) - 1));
    this.accBits += n;
    if (this.accBits >= 8) {
      this.grow(4);
      while (this.accBits >= 8) {
        this.accBits -= 8;
        this.buf[this.pos++] = (this.acc >>> this.accBits) & 0xff;
      }
      this.acc &= (1 << this.accBits) - 1;
    }
  }

  /** A two's-complement value in `n` bits. */
  signed(value: number, n: number): void {
    this.bits(value < 0 ? value + 2 ** n : value, n);
  }

  /** `q` zeros, then a one. */
  unary(q: number): void {
    while (q >= 24) {
      this.bits(0, 24);
      q -= 24;
    }
    this.bits(1, q + 1);
  }

  /** One Rice-coded residual with parameter `k`. */
  rice(residual: number, k: number): void {
    const u = residual >= 0 ? residual * 2 : -residual * 2 - 1;
    const q = Math.floor(u / 2 ** k);
    const low = u - q * 2 ** k;
    if (q + 1 + k <= 24) {
      this.bits((1 << k) | low, q + 1 + k);
    } else {
      this.unary(q);
      this.bits(low, k);
    }
  }

  alignToByte(): void {
    if (this.accBits) this.bits(0, 8 - this.accBits);
  }

  /** The bytes written so far (call after `alignToByte`). */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  /** Bytes from `start` to the current position. */
  slice(start: number): Uint8Array {
    return this.buf.subarray(start, this.pos);
  }
}

// ---------------------------------------------------------------- CRCs

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c8 = i;
  let c16 = i << 8;
  for (let b = 0; b < 8; b++) {
    c8 = c8 & 0x80 ? ((c8 << 1) ^ 0x07) & 0xff : (c8 << 1) & 0xff;
    c16 = c16 & 0x8000 ? ((c16 << 1) ^ 0x8005) & 0xffff : (c16 << 1) & 0xffff;
  }
  CRC8[i] = c8;
  CRC16[i] = c16;
}

export function crc8(bytes: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) c = CRC8[c ^ bytes[i]];
  return c;
}

export function crc16(bytes: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ bytes[i]];
  return c;
}

// ---------------------------------------------------------------- stream header

/** `fLaC` and a STREAMINFO block. The MD5 is left as zeros ("not computed"). */
export function streamHeader(info: StreamInfo): Uint8Array {
  const w = new BitWriter(64);
  for (const ch of 'fLaC') w.bits(ch.charCodeAt(0), 8);
  w.bits(1, 1); // last metadata block
  w.bits(0, 7); // STREAMINFO
  w.bits(34, 24);
  const block = Math.max(16, Math.min(BLOCK_SIZE, info.totalSamples));
  w.bits(block, 16); // min block size (the last block doesn't count)
  w.bits(block, 16); // max
  w.bits(0, 24); // min frame size: unknown
  w.bits(0, 24); // max frame size: unknown
  w.bits(info.sampleRate, 20);
  w.bits(info.channels - 1, 3);
  w.bits(info.bitsPerSample - 1, 5);
  w.bits(info.totalSamples, 36);
  for (let i = 0; i < 16; i++) w.bits(0, 8);
  return w.bytes().slice();
}

// ---------------------------------------------------------------- subframes

/** Scratch space, reused across frames. */
const residualBuf = new Int32Array(BLOCK_SIZE);
const sums = new Float64Array(1 << MAX_PARTITION_ORDER);

function fixedResidual(x: Int32Array, n: number, order: number, out: Int32Array): void {
  switch (order) {
    case 0: for (let i = 0; i < n; i++) out[i] = x[i]; break;
    case 1: for (let i = 1; i < n; i++) out[i] = x[i] - x[i - 1]; break;
    case 2: for (let i = 2; i < n; i++) out[i] = x[i] - 2 * x[i - 1] + x[i - 2]; break;
    case 3: for (let i = 3; i < n; i++) out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
    case 4: for (let i = 4; i < n; i++) out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]; break;
  }
}

/** Estimated bits for `count` residuals summing (folded) to `sum` with parameter k. */
function riceBits(sum: number, count: number, k: number): number {
  return count * (k + 1) + Math.floor(sum / 2 ** k);
}

function bestK(sum: number, count: number): number {
  if (count === 0 || sum === 0) return 0;
  const mean = sum / count;
  const guess = Math.max(0, Math.min(30, Math.floor(Math.log2(mean))));
  let best = guess;
  let bestBits = riceBits(sum, count, guess);
  for (const k of [guess - 1, guess + 1]) {
    if (k < 0 || k > 30) continue;
    const b = riceBits(sum, count, k);
    if (b < bestBits) { best = k; bestBits = b; }
  }
  return best;
}

interface RicePlan {
  bits: number;
  partitionOrder: number;
  params: number[];
}

/** The cheapest partitioning of `residualBuf[order..n)`. */
function planRice(n: number, order: number): RicePlan {
  let maxP = 0;
  while (maxP < MAX_PARTITION_ORDER && n % (1 << (maxP + 1)) === 0 && (n >> (maxP + 1)) > order) maxP++;

  // Folded sums for the finest partitions, then pairwise up to coarser ones.
  const parts = 1 << maxP;
  const size = n >> maxP;
  for (let j = 0; j < parts; j++) {
    let s = 0;
    for (let i = j === 0 ? order : j * size, end = (j + 1) * size; i < end; i++) {
      const r = residualBuf[i];
      s += r >= 0 ? r * 2 : -r * 2 - 1;
    }
    sums[j] = s;
  }

  let best: RicePlan | null = null;
  for (let p = maxP; p >= 0; p--) {
    const count = 1 << p;
    const psize = n >> p;
    if (p < maxP) for (let j = 0; j < count; j++) sums[j] = sums[2 * j] + sums[2 * j + 1];
    const params: number[] = [];
    let bits = 2 + 4;
    let wide = false;
    for (let j = 0; j < count; j++) {
      const c = j === 0 ? psize - order : psize;
      const k = bestK(sums[j], c);
      if (k > 14) wide = true;
      params.push(k);
      bits += riceBits(sums[j], c, k);
    }
    bits += count * (wide ? 5 : 4);
    if (!best || bits < best.bits) best = { bits, partitionOrder: p, params };
  }
  return best!;
}

type SubframePlan =
  | { kind: 'constant'; bits: number }
  | { kind: 'verbatim'; bits: number }
  | { kind: 'fixed'; bits: number; order: number; rice: RicePlan };

function planSubframe(x: Int32Array, n: number, bps: number): SubframePlan {
  let constant = true;
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) return { kind: 'constant', bits: 8 + bps };

  let best: SubframePlan = { kind: 'verbatim', bits: 8 + n * bps };
  for (let order = 0; order <= MAX_FIXED_ORDER && order < n; order++) {
    fixedResidual(x, n, order, residualBuf);
    const rice = planRice(n, order);
    const bits = 8 + order * bps + rice.bits;
    if (bits < best.bits) best = { kind: 'fixed', bits, order, rice };
  }
  return best;
}

function writeSubframe(w: BitWriter, x: Int32Array, n: number, bps: number, plan: SubframePlan): void {
  w.bits(0, 1);
  if (plan.kind === 'constant') {
    w.bits(0, 6);
    w.bits(0, 1);
    w.signed(x[0], bps);
    return;
  }
  if (plan.kind === 'verbatim') {
    w.bits(1, 6);
    w.bits(0, 1);
    for (let i = 0; i < n; i++) w.signed(x[i], bps);
    return;
  }
  const { order, rice } = plan;
  w.bits(8 | order, 6);
  w.bits(0, 1);
  for (let i = 0; i < order; i++) w.signed(x[i], bps);
  fixedResidual(x, n, order, residualBuf);
  const wide = rice.params.some((k) => k > 14);
  w.bits(wide ? 1 : 0, 2);
  w.bits(rice.partitionOrder, 4);
  const psize = n >> rice.partitionOrder;
  for (let j = 0; j < rice.params.length; j++) {
    const k = rice.params[j];
    w.bits(k, wide ? 5 : 4);
    for (let i = j === 0 ? order : j * psize, end = (j + 1) * psize; i < end; i++) w.rice(residualBuf[i], k);
  }
}

// ---------------------------------------------------------------- frames

function writeUtf8(w: BitWriter, v: number): void {
  if (v < 0x80) { w.bits(v, 8); return; }
  let bytes = 2;
  while (bytes < 7 && v >= 2 ** (5 * bytes + 1)) bytes++;
  const lead = (0xff00 >> bytes) & 0xff;
  w.bits(lead | Math.floor(v / 2 ** (6 * (bytes - 1))), 8);
  for (let i = bytes - 2; i >= 0; i--) w.bits(0x80 | (Math.floor(v / 2 ** (6 * i)) & 0x3f), 8);
}

const mid = new Int32Array(BLOCK_SIZE);
const side = new Int32Array(BLOCK_SIZE);

/**
 * One frame of `n` samples per channel (`n` ≤ BLOCK_SIZE; only the last
 * frame may be shorter), appended to `w`.
 */
export function writeFrame(w: BitWriter, channels: Int32Array[], n: number, bps: number, frameNumber: number): void {
  const start = w.byteLength;

  // Pick a channel layout: for stereo, the cheapest of four.
  let assignment = channels.length - 1;
  let subframes: { x: Int32Array; bps: number; plan: SubframePlan }[];
  if (channels.length === 2) {
    const [l, r] = channels;
    for (let i = 0; i < n; i++) {
      mid[i] = (l[i] + r[i]) >> 1;
      side[i] = l[i] - r[i];
    }
    const pl = planSubframe(l, n, bps);
    const pr = planSubframe(r, n, bps);
    const pm = planSubframe(mid, n, bps);
    const ps = planSubframe(side, n, bps + 1);
    const options = [
      { assignment: 1, bits: pl.bits + pr.bits, subs: [{ x: l, bps, plan: pl }, { x: r, bps, plan: pr }] },
      { assignment: 8, bits: pl.bits + ps.bits, subs: [{ x: l, bps, plan: pl }, { x: side, bps: bps + 1, plan: ps }] },
      { assignment: 9, bits: ps.bits + pr.bits, subs: [{ x: side, bps: bps + 1, plan: ps }, { x: r, bps, plan: pr }] },
      { assignment: 10, bits: pm.bits + ps.bits, subs: [{ x: mid, bps, plan: pm }, { x: side, bps: bps + 1, plan: ps }] },
    ];
    const best = options.reduce((a, b) => (b.bits < a.bits ? b : a));
    assignment = best.assignment;
    subframes = best.subs;
  } else {
    subframes = channels.map((x) => ({ x, bps, plan: planSubframe(x, n, bps) }));
  }

  // Header.
  const blockCode = n === BLOCK_SIZE ? 0b1100 : 0b0111;
  w.bits(0b11111111111110, 14);
  w.bits(0, 1); // reserved
  w.bits(0, 1); // fixed block size
  w.bits(blockCode, 4);
  w.bits(0, 4); // sample rate: from STREAMINFO
  w.bits(assignment, 4);
  w.bits(bps === 16 ? 0b100 : 0b110, 3);
  w.bits(0, 1);
  writeUtf8(w, frameNumber);
  if (blockCode === 0b0111) w.bits(n - 1, 16);
  w.bits(crc8(w.slice(start)), 8);

  for (const s of subframes) writeSubframe(w, s.x, n, s.bps, s.plan);
  w.alignToByte();
  w.bits(crc16(w.slice(start)), 16);
}
