/**
 * Last step for a rendered stem: fit it under full scale and encode it.
 * Pure, so it runs in the audio worker.
 */
import type { Pcm } from './pcm';
import { encodeWavChannels } from '../utils/audioConvert';

export interface FinishedPcm {
  pcm: Pcm;
  wav: ArrayBuffer;
  /**
   * Factor the audio was turned down by to fit under full scale (1 when it
   * already fit). Multiply the stem's default volume by it to keep the level.
   */
  headroomGain: number;
}

/** Scale down if anything is over full scale (16-bit WAV would clip it). */
export function fitToFullScale(pcm: Pcm): number {
  let peak = 0;
  for (const ch of pcm.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak <= 1) return 1;
  for (const ch of pcm.channels) for (let i = 0; i < ch.length; i++) ch[i] /= peak;
  return peak;
}

export function finishPcm(pcm: Pcm): FinishedPcm {
  const headroomGain = fitToFullScale(pcm);
  return { pcm, wav: encodeWavChannels(pcm.channels, pcm.sampleRate), headroomGain };
}
