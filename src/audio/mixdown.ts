import type { AudioEngine } from './AudioEngine';

/**
 * Render a stereo downmix of the engine's current mixer state
 * (per-stem gain, pan, mono/stereo mode, alignment offset) via an
 * OfflineAudioContext. Uses the `.gain.value` already on each
 * StemPlayer's gainNode, which `recalcAllGains` maintains — so
 * solo/mute/group logic is baked in without re-deriving it here.
 *
 * Tempo-stretch and pitch correction are *not* applied: the export
 * is at the stems' natural tempo.
 */
export async function renderStereoDownmix(engine: AudioEngine): Promise<AudioBuffer> {
  const stems = engine.getAllStems();
  if (stems.size === 0) {
    throw new Error('No decoded stems to mix down');
  }

  const sampleRate = 44100;

  // Longest aligned stem determines the output duration. A negative
  // offsetSec seeks into the buffer, so the effective tail-end is
  // offsetSec + buffer.duration (clamped to a minimum of the buffer's
  // own duration — a stem can't finish before it starts).
  let durationSeconds = 0;
  for (const stem of stems.values()) {
    const end = Math.max(
      stem.audioBuffer.duration,
      stem.offsetSec + stem.audioBuffer.duration,
    );
    if (end > durationSeconds) durationSeconds = end;
  }
  if (durationSeconds <= 0) {
    throw new Error('Stems have zero duration');
  }

  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(durationSeconds * sampleRate),
    sampleRate,
  );

  for (const stem of stems.values()) {
    const source = ctx.createBufferSource();
    source.buffer = stem.audioBuffer;

    // Gain: read directly from the live node. recalcAllGains has
    // already folded in solo/mute/group logic.
    const gain = ctx.createGain();
    gain.gain.value = stem.gainNode.gain.value;

    // Mono/stereo routing: mirror StemPlayer.monoMixer. In mono mode,
    // downmix stereo to 1 channel then use the stem's pan. In stereo
    // mode, keep both channels and zero the pan.
    const panner = ctx.createStereoPanner();
    let head: AudioNode = source;
    if (!stem.stereo) {
      const monoMixer = ctx.createGain();
      monoMixer.channelCount = 1;
      monoMixer.channelCountMode = 'explicit';
      monoMixer.channelInterpretation = 'speakers';
      source.connect(monoMixer);
      head = monoMixer;
      panner.pan.value = stem.pan;
    } else {
      panner.pan.value = 0;
    }

    head.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);

    // Alignment: mirror StemPlayer.start(when=0, globalPos=0).
    // offsetSec >= 0 → delay the start; < 0 → start at t=0 but seek
    // into the buffer at -offsetSec.
    if (stem.offsetSec >= 0) {
      source.start(stem.offsetSec);
    } else {
      source.start(0, -stem.offsetSec);
    }
  }

  return ctx.startRendering();
}
