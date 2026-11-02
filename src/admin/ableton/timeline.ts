/**
 * Arrangement time math for an Ableton set.
 *
 * Three clocks are in play:
 *   - arrangement beats (clip positions, fades, automation, locators)
 *   - arrangement seconds (where audio lands in the rendered stem)
 *   - sample seconds (where to read in the source file)
 *
 * The tempo map converts the first to the second; a warped clip's warp
 * markers convert clip beats to the third. `clipSegments` combines them into
 * a flat list of buffer-source playbacks.
 */
import type { AlsAudioClip, AlsAutomationPoint, AlsWarpMarker } from './alsParser';

/** One AudioBufferSourceNode playback. */
export interface ClipSegment {
  /** Start in the rendered stem, seconds. */
  when: number;
  /** Start in the source file, seconds. */
  offset: number;
  /** Length in the rendered stem, seconds. */
  duration: number;
  /** Source seconds per stem second. */
  rate: number;
}

export interface ClipPlan {
  clip: AlsAudioClip;
  startSec: number;
  endSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  segments: ClipSegment[];
  warnings: string[];
}

/** Rates further than this from 1 change pitch audibly; flag them. */
const RATE_TOLERANCE = 0.005;
/** Pieces shorter than this (seconds) fold into a neighbour when merging. */
const SLIVER = 0.01;
/** Tempo ramps are sampled at this beat resolution. */
const RAMP_STEP = 1;

export class TempoMap {
  private readonly points: AlsAutomationPoint[];

  constructor(points: AlsAutomationPoint[]) {
    this.points = points.length > 0 ? [...points].sort((a, b) => a.beat - b.beat) : [{ beat: 0, value: 120 }];
  }

  /** Beats where the tempo changes or a ramp starts, for splitting segments. */
  get breakpoints(): number[] {
    return this.points.map((p) => p.beat);
  }

  get initialBpm(): number {
    return this.points[0].value;
  }

  /** True when the tempo ramps (rather than stepping) anywhere. */
  isRampAt(beat: number): boolean {
    const i = this.indexAt(beat);
    const next = this.points[i + 1];
    return !!next && next.beat > this.points[i].beat && next.value !== this.points[i].value;
  }

  private indexAt(beat: number): number {
    let i = 0;
    while (i + 1 < this.points.length && this.points[i + 1].beat <= beat) i++;
    return i;
  }

  bpmAt(beat: number): number {
    const i = this.indexAt(beat);
    const a = this.points[i];
    const b = this.points[i + 1];
    if (!b || b.beat <= a.beat || beat <= a.beat) return a.value;
    return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
  }

  /**
   * Seconds from beat 0 to `beat`. Live interpolates tempo automation
   * linearly in beats, so each ramp integrates to a log.
   */
  beatToSec(beat: number): number {
    const pts = this.points;
    // Before the first point, its value holds.
    const lead = Math.min(beat, Math.max(0, pts[0].beat));
    let sec = (60 * lead) / pts[0].value;
    // Each pair of points is one segment, interpolated from its own two
    // values. A tempo step is two points at the same beat, a zero-length
    // segment, so the value after a step never leaks into the segment
    // before it.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const from = Math.max(a.beat, lead);
      const to = b ? Math.min(b.beat, beat) : beat;
      if (to > from) {
        const at = (x: number) => (b && b.beat > a.beat ? a.value + ((b.value - a.value) * (x - a.beat)) / (b.beat - a.beat) : a.value);
        const v0 = at(from);
        const v1 = at(to);
        if (Math.abs(v1 - v0) < 1e-9) {
          sec += (60 * (to - from)) / v0;
        } else {
          const slope = (v1 - v0) / (to - from);
          sec += (60 / slope) * Math.log(v1 / v0);
        }
      }
      if (!b || b.beat >= beat) break;
    }
    return sec;
  }
}

/** Map a clip beat to sample seconds through the warp markers. */
export function warpBeatToSec(markers: AlsWarpMarker[], beat: number): number {
  if (markers.length === 0) return (beat * 60) / 120;
  if (markers.length === 1) return markers[0].secTime + ((beat - markers[0].beatTime) * 60) / 120;
  let i = 0;
  while (i + 2 < markers.length && markers[i + 1].beatTime <= beat) i++;
  const a = markers[i];
  const b = markers[i + 1];
  const slope = (b.secTime - a.secTime) / (b.beatTime - a.beatTime);
  return a.secTime + (beat - a.beatTime) * slope;
}

/**
 * The clip's content as source-domain pieces, in playback order: from the
 * start marker to the loop end, then the loop region repeated while
 * `LoopOn`, until `length` (in the same units) is covered.
 */
function contentPieces(clip: AlsAudioClip, length: number): Array<[number, number]> {
  const first = clip.loopStart + clip.startRelative;
  if (!clip.loopOn) return [[first, first + length]];
  const loopLen = clip.loopEnd - clip.loopStart;
  const pieces: Array<[number, number]> = [];
  let remaining = length;
  let from = first;
  while (remaining > 1e-9) {
    const take = Math.min(clip.loopEnd - from, remaining);
    if (take <= 1e-9 && loopLen <= 1e-9) break;
    if (take > 1e-9) pieces.push([from, from + take]);
    remaining -= Math.max(take, 0);
    from = clip.loopStart;
  }
  return pieces;
}

function mergeSegments(segments: ClipSegment[]): ClipSegment[] {
  const out: ClipSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    const contiguous =
      prev &&
      Math.abs(prev.offset + prev.duration * prev.rate - seg.offset) < 1e-6 &&
      Math.abs(prev.when + prev.duration - seg.when) < 1e-6;
    const similar =
      prev && (Math.abs(prev.rate - seg.rate) < 1e-4 || prev.duration < SLIVER || seg.duration < SLIVER);
    if (prev && contiguous && similar) {
      const src = prev.duration * prev.rate + seg.duration * seg.rate;
      prev.duration += seg.duration;
      prev.rate = src / prev.duration;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function warpedSegments(clip: AlsAudioClip, tempo: TempoMap): ClipSegment[] {
  const segments: ClipSegment[] = [];
  let arrBeat = clip.start;
  for (const [p0, p1] of contentPieces(clip, clip.end - clip.start)) {
    const shift = arrBeat - p0; // arrangement beat = clip beat + shift
    // Split at warp markers and tempo changes so each piece has one rate.
    const cuts = new Set<number>([p0, p1]);
    for (const m of clip.warpMarkers) if (m.beatTime > p0 && m.beatTime < p1) cuts.add(m.beatTime);
    for (const b of tempo.breakpoints) if (b - shift > p0 && b - shift < p1) cuts.add(b - shift);
    for (let b = Math.ceil(p0); b < p1; b += RAMP_STEP) {
      if (b > p0 && tempo.isRampAt(b + shift)) cuts.add(b);
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const c0 = sorted[i];
      const c1 = sorted[i + 1];
      const when = tempo.beatToSec(c0 + shift);
      const duration = tempo.beatToSec(c1 + shift) - when;
      const offset = warpBeatToSec(clip.warpMarkers, c0);
      const src = warpBeatToSec(clip.warpMarkers, c1) - offset;
      if (duration > 0) segments.push({ when, offset, duration, rate: src / duration });
    }
    arrBeat += p1 - p0;
  }
  return segments;
}

function unwarpedSegments(clip: AlsAudioClip, tempo: TempoMap): ClipSegment[] {
  const rate = 2 ** (clip.pitch / 12);
  const startSec = tempo.beatToSec(clip.start);
  const timelineLen = tempo.beatToSec(clip.end) - startSec;
  const segments: ClipSegment[] = [];
  let when = startSec;
  for (const [s0, s1] of contentPieces(clip, timelineLen * rate)) {
    const duration = (s1 - s0) / rate;
    segments.push({ when, offset: s0, duration, rate });
    when += duration;
  }
  return segments;
}

/** Plan how to render one arrangement clip. */
export function planClip(clip: AlsAudioClip, tempo: TempoMap): ClipPlan {
  const warnings: string[] = [];
  const startSec = tempo.beatToSec(clip.start);
  const endSec = tempo.beatToSec(clip.end);
  const segments = mergeSegments(clip.isWarped ? warpedSegments(clip, tempo) : unwarpedSegments(clip, tempo));

  if (clip.isWarped && clip.pitch !== 0) {
    warnings.push(`"${clip.name}" is transposed ${clip.pitch} semitones in a warped clip; the transpose is not applied`);
  }
  const stretched = segments.find((s) => Math.abs(s.rate - 1) > RATE_TOLERANCE && s.duration >= SLIVER);
  if (clip.isWarped && stretched) {
    warnings.push(
      `"${clip.name}" is warped to ${Math.round(stretched.rate * 1000) / 10}% speed and is time-stretched to match, which can sound slightly different from Ableton's warp modes`,
    );
  }
  if (clip.hasClipEnvelopes) {
    warnings.push(`"${clip.name}" has clip automation, which is not applied`);
  }

  return {
    clip,
    startSec,
    endSec,
    fadeInSec: tempo.beatToSec(clip.start + clip.fadeIn) - startSec,
    fadeOutSec: endSec - tempo.beatToSec(clip.end - clip.fadeOut),
    segments,
    warnings,
  };
}
