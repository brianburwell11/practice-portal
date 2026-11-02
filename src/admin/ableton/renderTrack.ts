/**
 * Render one Ableton track's arrangement to a stem that starts at 0.
 *
 * Every clip becomes one or more AudioBufferSourceNodes (see `planClip`)
 * through a per-clip gain carrying clip gain and fades, into a track gain
 * carrying volume automation. Static track volume and pan are left out:
 * they become the stem's mixer defaults instead.
 *
 * Only the Web Audio parts run on the page (decoding and the offline
 * render, which Chrome runs on its own thread). Time-stretching, peak
 * fitting and WAV encoding run in the audio worker.
 */
import type { AlsAudioClip, AlsTrack } from './alsParser';
import type { ClipPlan, TempoMap } from './timeline';
import { planClip } from './timeline';
import { decodeSource } from './decodeSource';
import { PRE_ROLL_SEC } from './stretch';
import type { Pcm } from './pcm';
import { pcmFromAudioBuffer, pcmToAudioBuffer } from './pcm';
import { callAudioWorker } from './workerClient';

export const RENDER_SAMPLE_RATE = 48000;

/**
 * Warped segments within this of normal speed are resampled: the pitch
 * change is under 9 cents, and it avoids stretching artifacts.
 */
const STRETCH_TOLERANCE = 0.005;

/** A track's raw render, before fitting and encoding. */
export interface RenderedPcm {
  pcm: Pcm;
  /** Peak of the volume automation, which becomes the stem's default volume. */
  automationPeak: number | null;
  warnings: string[];
}

export interface RenderedTrack {
  buffer: AudioBuffer;
  file: File;
  /** Peak of the volume automation, which becomes the stem's default volume. */
  automationPeak: number | null;
  /**
   * Factor the render was turned down by to fit under full scale (1 when it
   * already fit). Multiply the stem's default volume by it to keep the level.
   */
  headroomGain: number;
  warnings: string[];
}

/** Clips that will actually make sound: enabled and with a resolved file. */
export function playableClips(track: AlsTrack, resolve: (clip: AlsAudioClip) => File | null): AlsAudioClip[] {
  return track.clips.filter((c) => !c.disabled && c.end > c.start && resolve(c));
}

/** Where a segment actually plays, trimmed to the source and the file start. */
function placeSegment(seg: ClipPlan['segments'][number], source: AudioBuffer, sampleRate: number) {
  let { offset, duration } = seg;
  // Start on a whole sample: fractional starts get interpolated, which
  // softens the copy.
  let when = Math.round(seg.when * sampleRate) / sampleRate;
  if (offset < 0) {
    // Warp markers extrapolated before the file starts: that part is silence.
    const skip = -offset / seg.rate;
    when += skip;
    duration -= skip;
    offset = 0;
  }
  duration = Math.min(duration, (source.duration - offset) / seg.rate);
  return { when, offset, duration };
}

function needsStretch(plan: ClipPlan, rate: number): boolean {
  return plan.clip.isWarped && Math.abs(rate - 1) > STRETCH_TOLERANCE;
}

/**
 * Warping changes speed, not pitch, so warped segments that aren't near
 * normal speed are time-stretched (in the worker) instead of resampled.
 */
async function stretchSegment(
  source: AudioBuffer,
  offset: number,
  duration: number,
  rate: number,
): Promise<AudioBuffer> {
  const sr = source.sampleRate;
  const start = Math.round(offset * sr);
  const end = Math.min(source.length, Math.round((offset + duration * rate) * sr));
  const pre = Math.round(PRE_ROLL_SEC * sr);
  const input = pcmFromAudioBuffer(source, start - pre, end);
  const outLength = Math.max(1, Math.round((end - start) / rate));
  return pcmToAudioBuffer(await callAudioWorker('stretch', [input, pre, rate, outLength]));
}

function scheduleClip(
  ctx: OfflineAudioContext,
  plan: ClipPlan,
  source: AudioBuffer,
  stretched: (AudioBuffer | null)[],
  out: AudioNode,
): void {
  const { clip, startSec, endSec, fadeInSec, fadeOutSec } = plan;
  const gain = ctx.createGain();
  const level = clip.gain;
  const param = gain.gain;
  if (fadeInSec > 0) {
    param.setValueAtTime(0, startSec);
    param.linearRampToValueAtTime(level, startSec + fadeInSec);
  } else {
    param.setValueAtTime(level, startSec);
  }
  if (fadeOutSec > 0) {
    param.setValueAtTime(level, Math.max(startSec + fadeInSec, endSec - fadeOutSec));
    param.linearRampToValueAtTime(0, endSec);
  }
  gain.connect(out);

  plan.segments.forEach((seg, i) => {
    const { when, offset, duration } = placeSegment(seg, source, ctx.sampleRate);
    if (duration <= 0) return;
    const node = ctx.createBufferSource();
    node.connect(gain);
    const stretchedBuffer = stretched[i];
    if (stretchedBuffer) {
      node.buffer = stretchedBuffer;
      node.start(when, 0, duration);
    } else {
      node.buffer = source;
      node.playbackRate.value = seg.rate;
      node.start(when, offset, duration * seg.rate);
    }
  });
}

function scheduleVolumeAutomation(
  track: AlsTrack,
  tempo: TempoMap,
  node: GainNode,
): number | null {
  const points = track.volumeAutomation;
  if (points.length === 0) return null;
  const peak = Math.max(...points.map((p) => p.value));
  if (peak <= 0) return null;
  node.gain.setValueAtTime(points[0].value / peak, 0);
  for (const p of points.slice(1)) {
    node.gain.linearRampToValueAtTime(p.value / peak, tempo.beatToSec(p.beat));
  }
  return peak;
}

/** Render a track to raw PCM: no fitting under full scale, no WAV. */
export async function renderTrackPcm(
  track: AlsTrack,
  tempo: TempoMap,
  lengthSec: number,
  resolve: (clip: AlsAudioClip) => File | null,
): Promise<RenderedPcm> {
  const clips = playableClips(track, resolve);
  const plans = clips.map((c) => planClip(c, tempo));
  const warnings = plans.flatMap((p) => p.warnings);
  if (track.panAutomation.length > 0) warnings.push('Pan automation is not applied');

  // Decode each source file once.
  const sources = new Map<File, AudioBuffer>();
  for (const clip of clips) {
    const file = resolve(clip)!;
    if (sources.has(file)) continue;
    try {
      sources.set(file, await decodeSource(file, RENDER_SAMPLE_RATE));
    } catch (e) {
      throw new Error(`Track "${track.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const channels = Math.max(1, ...[...sources.values()].map((b) => Math.min(2, b.numberOfChannels)));

  // Stretch speed-warped segments in the worker before scheduling.
  const stretched: (AudioBuffer | null)[][] = [];
  for (const [i, plan] of plans.entries()) {
    const source = sources.get(resolve(clips[i])!)!;
    const perSegment: (AudioBuffer | null)[] = [];
    for (const seg of plan.segments) {
      const placed = placeSegment(seg, source, RENDER_SAMPLE_RATE);
      perSegment.push(
        placed.duration > 0 && needsStretch(plan, seg.rate)
          ? await stretchSegment(source, placed.offset, placed.duration, seg.rate)
          : null,
      );
    }
    stretched.push(perSegment);
  }

  const length = Math.max(1, Math.ceil(lengthSec * RENDER_SAMPLE_RATE));
  const ctx = new OfflineAudioContext(channels, length, RENDER_SAMPLE_RATE);
  const trackGain = ctx.createGain();
  trackGain.connect(ctx.destination);
  const automationPeak = scheduleVolumeAutomation(track, tempo, trackGain);

  plans.forEach((plan, i) => scheduleClip(ctx, plan, sources.get(resolve(clips[i])!)!, stretched[i], trackGain));
  sources.clear();

  const buffer = await ctx.startRendering();
  return { pcm: pcmFromAudioBuffer(buffer), automationPeak, warnings };
}

/** Render a track to a finished stem: fitted under full scale and encoded as WAV. */
export async function renderTrack(
  track: AlsTrack,
  tempo: TempoMap,
  lengthSec: number,
  resolve: (clip: AlsAudioClip) => File | null,
): Promise<RenderedTrack> {
  const raw = await renderTrackPcm(track, tempo, lengthSec, resolve);
  const finished = await callAudioWorker('finish', [raw.pcm]);
  return {
    buffer: pcmToAudioBuffer(finished.pcm),
    file: new File([finished.wav], `${track.name}.wav`, { type: 'audio/wav' }),
    automationPeak: raw.automationPeak,
    headroomGain: finished.headroomGain,
    warnings: raw.warnings,
  };
}
