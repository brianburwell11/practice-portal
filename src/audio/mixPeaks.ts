/**
 * Waveform envelopes for the live mix. Each stem gets one envelope (peak
 * amplitude per bucket, in its own time) computed once at decode. The mix
 * envelope is rebuilt from those whenever a stem's gain changes, shifted by
 * each stem's alignment offset so it shows what's actually playing.
 */

/** Buckets per second of audio: 10 ms each. */
export const PEAKS_PER_SECOND = 100;

/** Peak |amplitude| per bucket of the stem's mono downmix, in the stem's own time. */
export function computeStemEnvelope(buffer: AudioBuffer, rate = PEAKS_PER_SECOND): Float32Array {
  const { sampleRate, length, numberOfChannels } = buffer;
  const samplesPerBucket = sampleRate / rate;
  const bucketCount = Math.ceil(length / samplesPerBucket);
  const env = new Float32Array(bucketCount);
  // Song load runs this for every stem on the main thread, so mono and stereo
  // get their own tight loops; anything else is downmixed first.
  const a = buffer.getChannelData(0);
  let b2: Float32Array | null = null;
  if (numberOfChannels === 2) {
    b2 = buffer.getChannelData(1);
  } else if (numberOfChannels > 2) {
    const mixed = new Float32Array(length);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let s = 0; s < length; s++) mixed[s] += d[s];
    }
    for (let s = 0; s < length; s++) mixed[s] /= numberOfChannels;
    return computeStemEnvelope(
      { sampleRate, length, numberOfChannels: 1, getChannelData: () => mixed } as unknown as AudioBuffer,
      rate,
    );
  }

  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(length, Math.floor((b + 1) * samplesPerBucket));
    let hi = 0;
    let lo = 0;
    if (b2) {
      for (let s = start; s < end; s++) {
        const v = a[s] + b2[s];
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      env[b] = Math.max(hi, -lo) * 0.5;
    } else {
      for (let s = start; s < end; s++) {
        const v = a[s];
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      env[b] = Math.max(hi, -lo);
    }
  }
  return env;
}

export interface MixInput {
  env: Float32Array;
  offsetSec: number;
  gain: number;
}

/**
 * Combine stem envelopes into one, in song time. Each stem is shifted by its
 * offset (positive delays it, negative skips its start) and scaled by its gain.
 * Stems combine as root-sum-square: exact for one stem, and doesn't balloon
 * when many stems play at once.
 */
export function mixEnvelopes(stems: MixInput[], duration: number, rate = PEAKS_PER_SECOND): Float32Array {
  const bucketCount = Math.max(0, Math.ceil(duration * rate));
  const sumSq = new Float32Array(bucketCount);
  for (const { env, offsetSec, gain } of stems) {
    if (gain <= 0) continue;
    const shift = Math.round(offsetSec * rate);
    const first = Math.max(0, shift);
    const last = Math.min(bucketCount, shift + env.length);
    for (let i = first; i < last; i++) {
      const v = env[i - shift] * gain;
      sumSq[i] += v * v;
    }
  }
  for (let i = 0; i < bucketCount; i++) sumSq[i] = Math.sqrt(sumSq[i]);
  return sumSq;
}

export function maxOf(env: Float32Array): number {
  let max = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
  return max;
}
