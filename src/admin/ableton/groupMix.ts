/**
 * Sum several rendered tracks into one stem, for importing an Ableton group
 * as a single stem.
 *
 * Tracks are added one at a time and folded into a running stereo sum, so
 * only one track's audio is held besides the sum. Each track's gain and pan
 * are baked in using the same equal-power law as Web Audio's
 * StereoPannerNode, which is what the player uses for a stem's pan.
 *
 * Works on plain PCM so it runs in the audio worker.
 */
import type { Pcm } from './pcm';

export interface MixedGroup {
  pcm: Pcm;
  /** Factor the sum was turned down by to fit under full scale (1 when it fit). */
  headroomGain: number;
  /** Samples a peak limiter pulled under full scale (0 when none were over). */
  limitedSamples: number;
}

/** Peak ceiling for the limiter, just under full scale. */
const CEILING = 0.98;
const ATTACK_SEC = 0.005;
const RELEASE_SEC = 0.05;
/** Past this share of samples over the ceiling, scale the whole mix instead. */
const MAX_LIMITED_SHARE = 0.001;

/**
 * Pull isolated overs under the ceiling with a look-ahead peak limiter:
 * gain ramps down over the attack before each over and recovers over the
 * release after it, and is untouched everywhere else. Summing tracks makes
 * brief overs common (Live groups usually carry a Limiter for this), and
 * limiting them costs far less level than scaling the whole stem.
 * Returns the number of samples limited, or null when there are too many
 * overs for that to be transparent.
 */
function limitOvers(channels: Float32Array[], sampleRate: number): number | null {
  const length = channels[0].length;
  const overs: number[] = [];
  for (let i = 0; i < length; i++) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
    if (peak > CEILING) overs.push(i);
  }
  if (overs.length === 0) return 0;
  if (overs.length > length * MAX_LIMITED_SHARE) return null;

  const attack = Math.round(ATTACK_SEC * sampleRate);
  const release = Math.round(RELEASE_SEC * sampleRate);
  const gain = new Map<number, number>();
  const lower = (j: number, g: number) => {
    if (j < 0 || j >= length) return;
    const cur = gain.get(j);
    if (cur === undefined || g < cur) gain.set(j, g);
  };
  for (const i of overs) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]));
    const target = CEILING / peak;
    for (let k = attack; k > 0; k--) lower(i - k, 1 - ((1 - target) * (attack - k)) / attack);
    lower(i, target);
    for (let k = 1; k <= release; k++) lower(i + k, target + ((1 - target) * k) / release);
  }
  for (const [j, g] of gain) for (const ch of channels) ch[j] *= g;
  return overs.length;
}

export class GroupMixer {
  private left: Float32Array<ArrayBuffer>;
  private right: Float32Array<ArrayBuffer>;
  private stereo = false;
  private readonly sampleRate: number;

  constructor(length: number, sampleRate: number) {
    this.left = new Float32Array(length);
    this.right = new Float32Array(length);
    this.sampleRate = sampleRate;
  }

  private ensureLength(length: number): void {
    if (length <= this.left.length) return;
    const grow = (a: Float32Array<ArrayBuffer>) => {
      const b = new Float32Array(length);
      b.set(a);
      return b;
    };
    this.left = grow(this.left);
    this.right = grow(this.right);
  }

  /** Add a track at `gain` (linear) and `pan` (-1 to 1). */
  add(track: Pcm, gain: number, pan: number): void {
    if (track.sampleRate !== this.sampleRate) {
      throw new Error(`Can't mix ${track.sampleRate} Hz audio into a ${this.sampleRate} Hz group`);
    }
    this.ensureLength(track.channels[0].length);
    const p = Math.max(-1, Math.min(1, pan));
    const inL = track.channels[0];
    const inR = track.channels.length > 1 ? track.channels[1] : null;
    const { left, right } = this;
    if (p !== 0) this.stereo = true;

    if (!inR) {
      const x = ((p + 1) / 2) * (Math.PI / 2);
      const gl = gain * Math.cos(x);
      const gr = gain * Math.sin(x);
      for (let i = 0; i < inL.length; i++) {
        left[i] += inL[i] * gl;
        right[i] += inL[i] * gr;
      }
      return;
    }

    this.stereo = true;
    if (p <= 0) {
      const x = (p + 1) * (Math.PI / 2);
      const keep = Math.cos(x);
      const toRight = Math.sin(x);
      for (let i = 0; i < inL.length; i++) {
        left[i] += gain * (inL[i] + inR[i] * keep);
        right[i] += gain * inR[i] * toRight;
      }
    } else {
      const x = p * (Math.PI / 2);
      const toLeft = Math.cos(x);
      const keep = Math.sin(x);
      for (let i = 0; i < inL.length; i++) {
        left[i] += gain * inL[i] * toLeft;
        right[i] += gain * (inR[i] + inL[i] * keep);
      }
    }
  }

  /** Finish the sum. Mono when every input was mono and centered. */
  finish(): MixedGroup {
    // A centered mono input lands at cos(pi/4) in each side; undo that for a mono sum.
    if (!this.stereo) for (let i = 0; i < this.left.length; i++) this.left[i] *= Math.SQRT2;
    const outs = this.stereo ? [this.left, this.right] : [this.left];

    let headroomGain = 1;
    const limited = limitOvers(outs, this.sampleRate);
    if (limited === null) {
      let peak = 0;
      for (const ch of outs) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
      headroomGain = peak;
      for (const ch of outs) for (let i = 0; i < ch.length; i++) ch[i] /= peak;
    }
    return { pcm: { sampleRate: this.sampleRate, channels: outs }, headroomGain, limitedSamples: limited ?? 0 };
  }
}
