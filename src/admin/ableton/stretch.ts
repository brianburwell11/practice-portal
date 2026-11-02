/**
 * Offline, pitch-preserving time-stretch for warped clips, using the same
 * SoundTouch engine the player uses for tempo changes.
 *
 * Live plays a warped clip at whatever speed fits it to the set's tempo
 * without changing its pitch. Resampling (AudioBufferSourceNode
 * playbackRate) would change the pitch with the speed, by several
 * semitones for the 75% to 125% warps common in practice tracks, so warped
 * regions are stretched here instead and then played at rate 1.
 *
 * Everything here works on plain PCM so it can run in the audio worker.
 */
import { SoundTouch } from '@soundtouchjs/core';
import type { Pcm } from './pcm';

const CHUNK = 8192;

/**
 * Run `frames` of interleaved-ready input through SoundTouch and return up
 * to `maxOut` frames of output per channel.
 */
function runSoundTouch(
  read: (i: number) => [number, number],
  frames: number,
  rate: number,
  maxOut: number,
  stereo: boolean,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const st = new SoundTouch();
  st.tempo = rate;
  st.pitch = 1;
  const outL = new Float32Array(maxOut);
  const outR = stereo ? new Float32Array(maxOut) : outL;
  let written = 0;
  const chunk = new Float32Array(CHUNK * 2);
  const drain = () => {
    const out = st.outputBuffer;
    while (out.frameCount > 0 && written < maxOut) {
      const n = Math.min(out.frameCount, CHUNK, maxOut - written);
      out.receiveSamples(chunk, n);
      for (let i = 0; i < n; i++) {
        outL[written + i] = chunk[i * 2];
        if (stereo) outR[written + i] = chunk[i * 2 + 1];
      }
      written += n;
    }
  };
  for (let pos = 0; pos < frames && written < maxOut; pos += CHUNK) {
    const n = Math.min(CHUNK, frames - pos);
    for (let i = 0; i < n; i++) {
      const [l, r] = read(pos + i);
      chunk[i * 2] = l;
      chunk[i * 2 + 1] = r;
    }
    st.inputBuffer.putSamples(chunk, 0, n);
    st.process();
    drain();
  }
  // SoundTouch holds back a window of audio; push silence to flush it.
  chunk.fill(0);
  for (let guard = 0; written < maxOut && guard < 64; guard++) {
    st.inputBuffer.putSamples(chunk, 0, CHUNK);
    st.process();
    drain();
  }
  return [outL, outR];
}

/**
 * SoundTouch's output runs ahead of or behind the ideal `t / rate` by an
 * amount that depends on the rate (about -30 ms at 75% speed, -100 ms at
 * 50%). Measure it once per rate by stretching a train of tone bursts and
 * averaging how far each lands from where it should.
 */
const offsetCache = new Map<number, number>();
function outputOffsetSec(rate: number, sr: number): number {
  const key = Math.round(rate * 10000);
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;

  // Bursts longer than SoundTouch's skip so none are dropped at high rates.
  const period = 0.5;
  const count = 16;
  const lead = 0.5;
  const burst = Math.round(0.08 * sr);
  const frames = Math.round((lead + period * count + 0.5) * sr);
  const signal = new Float32Array(frames);
  for (let k = 0; k < count; k++) {
    const at = Math.round((lead + k * period) * sr);
    for (let i = 0; i < burst; i++) signal[at + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  }
  const [out] = runSoundTouch((i) => [signal[i], signal[i]], frames, rate, Math.round(frames / rate), false);

  // Compare each detected onset with the nearest place a burst should land,
  // so a split or missed burst can't throw the count off; take the median.
  const spacing = period / rate;
  const errors: number[] = [];
  let quiet = Infinity;
  for (let i = 0; i < out.length; i++) {
    const loud = Math.abs(out[i]) > 0.2;
    if (loud && quiet > 0.3 * spacing * sr) {
      const t = i / sr;
      const k = Math.round((t - lead / rate) / spacing);
      if (k >= 0 && k < count) errors.push(t - (lead + k * period) / rate);
    }
    quiet = loud ? 0 : quiet + 1;
  }
  errors.sort((a, b) => a - b);
  const offset = errors.length >= count / 2 ? errors[Math.floor(errors.length / 2)] : 0;
  offsetCache.set(key, offset);
  return offset;
}

/** Audio fed before a region so SoundTouch's window is primed at its start. */
export const PRE_ROLL_SEC = 0.25;

/**
 * Stretch a region to play at `rate` times its original speed (rate > 1 is
 * faster and shorter), keeping its pitch. `input` is the region with
 * `preFrames` of lead-in in front (real audio from before it, or silence);
 * the output is `outLength` frames lined up so region time t lands at
 * t / rate. Pure, so it runs in the audio worker.
 */
export function stretchPcm(input: Pcm, preFrames: number, rate: number, outLength: number): Pcm {
  const sr = input.sampleRate;
  const stereo = input.channels.length > 1;
  const inL = input.channels[0];
  const inR = stereo ? input.channels[1] : inL;
  const skip = Math.max(0, Math.round((preFrames / rate / sr + outputOffsetSec(rate, sr)) * sr));
  const [l, r] = runSoundTouch((i) => [inL[i], inR[i]], inL.length, rate, skip + outLength, stereo);
  const left = l.slice(skip, skip + outLength);
  return { sampleRate: sr, channels: stereo ? [left, r.slice(skip, skip + outLength)] : [left] };
}
