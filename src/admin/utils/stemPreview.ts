const WINDOW_SECONDS = 5;
const STEP_SECONDS = 0.5;
const FADE_SECONDS = 0.05;

function findLoudestWindow(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const windowSamples = Math.floor(WINDOW_SECONDS * sr);
  const stepSamples = Math.floor(STEP_SECONDS * sr);

  if (data.length <= windowSamples) return 0;

  let bestOffset = 0;
  let bestRms = 0;

  for (let start = 0; start + windowSamples <= data.length; start += stepSamples) {
    let sum = 0;
    for (let j = start; j < start + windowSamples; j++) {
      sum += data[j] * data[j];
    }
    const rms = sum / windowSamples;
    if (rms > bestRms) {
      bestRms = rms;
      bestOffset = start;
    }
  }

  return bestOffset / sr;
}

let sharedCtx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

export async function previewStem(
  file: File,
  onEnded: () => void,
): Promise<{ stop: () => void }> {
  const ctx = getContext();
  if (ctx.state === 'suspended') await ctx.resume();

  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const offset = findLoudestWindow(audioBuffer);
  const duration = Math.min(WINDOW_SECONDS, audioBuffer.duration - offset);

  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  // Fade in
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_SECONDS);
  // Fade out
  gain.gain.setValueAtTime(1, ctx.currentTime + duration - FADE_SECONDS);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gain);
  source.start(0, offset, duration);

  let stopped = false;

  source.onended = () => {
    if (!stopped) {
      stopped = true;
      gain.disconnect();
      onEnded();
    }
  };

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      source.stop();
      gain.disconnect();
    },
  };
}
