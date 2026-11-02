/**
 * Plain PCM audio: what crosses between the page and the audio worker.
 * Workers have no AudioBuffer, so heavy processing works on these, and the
 * page converts at the edges.
 */
export interface Pcm {
  sampleRate: number;
  /** One array per channel, all the same length. */
  channels: Float32Array<ArrayBuffer>[];
}

/** Copy frames [from, to) of an AudioBuffer out as PCM (pads with silence outside it). */
export function pcmFromAudioBuffer(buffer: AudioBuffer, from = 0, to = buffer.length): Pcm {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => {
    const out = new Float32Array(Math.max(0, to - from));
    const src = buffer.getChannelData(c);
    const a = Math.max(0, from);
    const b = Math.min(buffer.length, to);
    if (b > a) out.set(src.subarray(a, b), a - from);
    return out;
  });
  return { sampleRate: buffer.sampleRate, channels };
}

export function pcmToAudioBuffer(pcm: Pcm): AudioBuffer {
  const length = pcm.channels[0]?.length ?? 0;
  const buffer = new AudioBuffer({
    numberOfChannels: Math.max(1, pcm.channels.length),
    length: Math.max(1, length),
    sampleRate: pcm.sampleRate,
  });
  pcm.channels.forEach((data, c) => buffer.copyToChannel(data, c));
  return buffer;
}
