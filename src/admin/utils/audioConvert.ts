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

/** Return the duration in seconds, reusing the decode from convertToMono when possible. */
export async function getAudioDuration(file: File): Promise<number> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(buffer);
  return audio.duration;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);         // chunk size
  view.setUint16(20, 1, true);          // PCM format
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);              // block align
  view.setUint16(34, 16, true);                          // bits per sample

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

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
