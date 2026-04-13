/**
 * Lightweight playback engine for the stem alignment step.
 *
 * Each stem gets one AudioBufferSourceNode + GainNode. Per-stem offsets
 * are handled at scheduling time so dragging doesn't require re-padding
 * buffers — just stop + reschedule the affected source.
 *
 * Solo/mute precedence matches AudioEngine.recalcAllGains:
 * - If any stem is soloed, only soloed stems are audible.
 * - Muted always silences, regardless of solo.
 */

export interface AlignmentStem {
  id: string;
  buffer: AudioBuffer;
  offsetSec: number;
  muted?: boolean;
  soloed?: boolean;
}

interface LiveStem {
  id: string;
  buffer: AudioBuffer;
  offsetSec: number;
  muted: boolean;
  soloed: boolean;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

export class AlignmentPlayback {
  private ctx: AudioContext;
  private ownsCtx: boolean;
  private masterGain: GainNode;
  private stems = new Map<string, LiveStem>();
  private playing = false;
  /** Position in seconds at the last play() / pause() / seek() boundary. */
  private anchorPos = 0;
  /** ctx.currentTime at the last play() boundary. */
  private anchorCtxTime = 0;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext();
    this.ownsCtx = !ctx;
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  load(stems: AlignmentStem[]): void {
    this.stopAllSources();
    for (const live of this.stems.values()) live.gain.disconnect();
    this.stems.clear();

    for (const s of stems) {
      const gain = this.ctx.createGain();
      gain.connect(this.masterGain);
      this.stems.set(s.id, {
        id: s.id,
        buffer: s.buffer,
        offsetSec: s.offsetSec,
        muted: s.muted ?? false,
        soloed: s.soloed ?? false,
        gain,
        source: null,
      });
    }
    this.recalcGains();
  }

  /** Duration of the aligned song = max(offsetSec + buffer.duration) across stems. */
  get duration(): number {
    let max = 0;
    for (const s of this.stems.values()) {
      const end = s.offsetSec + s.buffer.duration;
      if (end > max) max = end;
    }
    return max;
  }

  /** Current playback position in seconds. */
  getPosition(): number {
    if (!this.playing) return this.anchorPos;
    return this.anchorPos + (this.ctx.currentTime - this.anchorCtxTime);
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const pos = this.anchorPos;
    this.anchorCtxTime = this.ctx.currentTime;
    this.playing = true;

    for (const live of this.stems.values()) {
      this.scheduleStem(live, pos);
    }
  }

  pause(): void {
    if (!this.playing) return;
    const pos = this.getPosition();
    this.stopAllSources();
    this.anchorPos = Math.max(0, pos);
    this.playing = false;
  }

  seek(seconds: number): void {
    const target = Math.max(0, seconds);
    if (this.playing) {
      this.stopAllSources();
      this.anchorPos = target;
      this.anchorCtxTime = this.ctx.currentTime;
      for (const live of this.stems.values()) {
        this.scheduleStem(live, target);
      }
    } else {
      this.anchorPos = target;
    }
  }

  setOffset(id: string, offsetSec: number): void {
    const live = this.stems.get(id);
    if (!live) return;
    live.offsetSec = offsetSec;
    if (this.playing) {
      this.stopSource(live);
      this.scheduleStem(live, this.getPosition());
    }
  }

  setMuted(id: string, muted: boolean): void {
    const live = this.stems.get(id);
    if (!live) return;
    live.muted = muted;
    this.recalcGains();
  }

  setSoloed(id: string, soloed: boolean): void {
    const live = this.stems.get(id);
    if (!live) return;
    live.soloed = soloed;
    this.recalcGains();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  destroy(): void {
    this.stopAllSources();
    for (const live of this.stems.values()) live.gain.disconnect();
    this.stems.clear();
    this.masterGain.disconnect();
    if (this.ownsCtx) this.ctx.close().catch(() => {});
  }

  // --- internals --------------------------------------------------------

  private scheduleStem(live: LiveStem, globalPos: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = live.buffer;
    source.connect(live.gain);

    const stemPos = globalPos - live.offsetSec;
    if (stemPos >= live.buffer.duration) {
      // Already past the end of this stem — nothing to schedule.
      source.disconnect();
      live.source = null;
      return;
    }

    if (stemPos >= 0) {
      // Stem is already underway — start now, into the buffer.
      source.start(this.ctx.currentTime, stemPos);
    } else {
      // Stem hasn't started yet — delay start by abs(stemPos) seconds.
      source.start(this.ctx.currentTime + -stemPos, 0);
    }
    live.source = source;
  }

  private stopSource(live: LiveStem): void {
    if (live.source) {
      try {
        live.source.stop();
      } catch {
        // already stopped / not started
      }
      live.source.disconnect();
      live.source = null;
    }
  }

  private stopAllSources(): void {
    for (const live of this.stems.values()) this.stopSource(live);
  }

  private recalcGains(): void {
    const anySoloActive = [...this.stems.values()].some((s) => s.soloed);
    for (const live of this.stems.values()) {
      const audibleBySolo = live.soloed || !anySoloActive;
      const audible = audibleBySolo && !live.muted;
      live.gain.gain.setTargetAtTime(audible ? 1 : 0, this.ctx.currentTime, 0.01);
    }
  }
}
