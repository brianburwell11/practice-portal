/** Decode an audio file and return a mono WAV File. Passes through files that are already mono. */
export async function convertToMono(file: File): Promise<File> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  if (audioBuffer.numberOfChannels === 1) {
    return file;
  }

  // Mix all channels down to mono
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const mono = new Float32Array(length);
  const numChannels = audioBuffer.numberOfChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / numChannels;
    }
  }

  const wavBytes = encodeWav(mono, sampleRate);
  const wavName = file.name.replace(/\.[^.]+$/, '.wav');
  return new File([wavBytes], wavName, { type: 'audio/wav' });
}

/** Return the duration in seconds. */
export async function getAudioDuration(file: File): Promise<number> {
  const info = await getAudioInfo(file);
  return info.duration;
}

/** Decode an audio file and return its duration, channel count, and decoded buffer. */
export async function getAudioInfo(file: File): Promise<{ duration: number; channels: number; buffer: AudioBuffer }> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const bytes = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(bytes);
  return { duration: audio.duration, channels: audio.numberOfChannels, buffer: audio };
}

/**
 * Encode raw PCM samples as a 16-bit WAV. For stereo, pass interleaved
 * samples (L,R,L,R,…) and `channels: 2`.
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  channels = 1,
): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = channels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                       // chunk size
  view.setUint16(20, 1, true);                        // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);  // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);                       // bits per sample

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

/** Interleave an AudioBuffer's channels into [L,R,L,R,…] for WAV encoding. */
export function interleaveStereo(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length * 2);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  for (let i = 0; i < length; i++) {
    out[i * 2] = left[i];
    out[i * 2 + 1] = right[i];
  }
  return out;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
