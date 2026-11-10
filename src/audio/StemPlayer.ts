/** An A/B loop in song seconds. The engine snaps both ends to the sample grid. */
export interface LoopRegion {
  start: number;
  end: number;
}

export class StemPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  readonly gainNode: GainNode;
  readonly panNode: StereoPannerNode;
  private monoMixer: GainNode;
  private _tempoRatio = 1.0;
  private _muted = false;
  private _soloed = false;
  private _userVolume: number;
  private _userPan: number;
  private _offsetSec: number;
  /** The gain last applied after mute, solo and group volume */
  private _effectiveGain: number;
  private loopRegion: LoopRegion | null = null;
  /** This stem's audio for the loop, for stems that start or end inside it */
  private segment: { region: LoopRegion; buffer: AudioBuffer } | null = null;
  private sourceIsSegment = false;

  constructor(
    ctx: AudioContext,
    buffer: AudioBuffer,
    destination: AudioNode,
    defaultVolume: number,
    defaultPan: number,
    offsetSec = 0,
  ) {
    this.ctx = ctx;
    this.buffer = buffer;
    this._userVolume = defaultVolume;
    this._userPan = defaultPan;
    this._offsetSec = offsetSec;
    this._effectiveGain = defaultVolume;

    // Mono mixer: downmixes stereo to mono by default
    this.monoMixer = ctx.createGain();
    this.monoMixer.channelCount = 1;
    this.monoMixer.channelCountMode = 'explicit';
    this.monoMixer.channelInterpretation = 'speakers';

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = defaultVolume;

    this.panNode = ctx.createStereoPanner();
    this.panNode.pan.value = defaultPan;

    // Chain: monoMixer → gain → pan → destination (mixBus)
    this.monoMixer.connect(this.gainNode);
    this.gainNode.connect(this.panNode);
    this.panNode.connect(destination);
  }

  /**
   * Start playback at a precise AudioContext time, from a global song position.
   * Applies this stem's alignment offsetSec: if the global position hasn't
   * reached the stem's start yet, schedules the start in the future with
   * buffer offset 0; otherwise starts now at the appropriate buffer offset.
   */
  start(when: number, globalPos: number): void {
    this.stop();

    const loop = this.loopRegion;
    if (loop && !this.covers(loop)) {
      this.startSegment(when, globalPos, loop);
      return;
    }

    const stemPos = globalPos - this._offsetSec;
    if (stemPos >= this.buffer.duration) return; // already past the end of this stem

    this.source = this.createSource(this.buffer);
    if (loop) {
      // The audio wraps from B to A by itself, sample-accurately, with no timer involved
      this.source.loop = true;
      this.source.loopStart = loop.start - this._offsetSec;
      this.source.loopEnd = loop.end - this._offsetSec;
    }

    if (stemPos >= 0) {
      this.source.start(when, stemPos);
    } else {
      // Delay start until globalPos reaches offsetSec
      this.source.start(when + -stemPos, 0);
    }
  }

  /**
   * Set or clear the A/B loop. Returns false when the playing source can't
   * take the change in place and the stem needs restarting.
   */
  setLoop(region: LoopRegion | null): boolean {
    this.loopRegion = region;
    if (this.segment && !(region && sameRegion(this.segment.region, region))) {
      this.segment = null;
    }
    if (!this.source) return true;
    if (this.sourceIsSegment || (region && !this.covers(region))) return false;
    this.source.loop = region !== null;
    if (region) {
      this.source.loopStart = region.start - this._offsetSec;
      this.source.loopEnd = region.end - this._offsetSec;
    }
    return true;
  }

  /** Whether this stem has audio for the whole loop, so its own buffer can loop */
  private covers(region: LoopRegion): boolean {
    return this._offsetSec <= region.start && this._offsetSec + this.buffer.duration >= region.end;
  }

  /**
   * Loop a stem that starts or ends inside the loop. Its buffer can't loop on
   * the same period as the others, so play a copy of just the loop section,
   * padded with silence, and loop that.
   */
  private startSegment(when: number, globalPos: number, loop: LoopRegion): void {
    this.source = this.createSource(this.segmentFor(loop));
    this.source.loop = true;
    this.sourceIsSegment = true;
    if (globalPos >= loop.start) {
      this.source.start(when, globalPos - loop.start);
    } else {
      this.source.start(when + (loop.start - globalPos), 0);
    }
  }

  private segmentFor(loop: LoopRegion): AudioBuffer {
    if (this.segment && sameRegion(this.segment.region, loop)) return this.segment.buffer;
    const rate = this.buffer.sampleRate;
    const length = Math.round((loop.end - loop.start) * rate);
    const buffer = this.ctx.createBuffer(this.buffer.numberOfChannels, length, rate);
    // Stem frame that lines up with the loop's first frame (negative if the stem starts later)
    const from = Math.round((loop.start - this._offsetSec) * rate);
    const first = Math.max(0, from);
    const last = Math.min(this.buffer.length, from + length);
    if (last > first) {
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        buffer.getChannelData(ch).set(this.buffer.getChannelData(ch).subarray(first, last), first - from);
      }
    }
    this.segment = { region: loop, buffer };
    return buffer;
  }

  private createSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this._tempoRatio;
    source.connect(this.monoMixer);
    this.sourceIsSegment = false;
    return source;
  }

  get offsetSec(): number {
    return this._offsetSec;
  }

  setTempo(ratio: number): void {
    this._tempoRatio = ratio;
    if (this.source) {
      this.source.playbackRate.value = ratio;
    }
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source.disconnect();
      this.source = null;
      this.sourceIsSegment = false;
    }
  }

  get volume(): number {
    return this._userVolume;
  }

  set volume(v: number) {
    this._userVolume = v;
    this.updateGain();
  }

  get pan(): number {
    return this._userPan;
  }

  set pan(v: number) {
    this._userPan = v;
    if (!this.stereo) {
      this.panNode.pan.value = v;
    }
  }

  /** Number of channels in the source audio (1 = mono, 2 = stereo) */
  get sourceChannels(): number {
    return this.buffer.numberOfChannels;
  }

  get stereo(): boolean {
    return this.monoMixer.channelCount === 2;
  }

  set stereo(s: boolean) {
    if (s) {
      this.monoMixer.channelCount = 2;
      this.panNode.pan.value = 0;
    } else {
      this.monoMixer.channelCount = 1;
      this.panNode.pan.value = this._userPan;
    }
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(m: boolean) {
    this._muted = m;
    this.updateGain();
  }

  get audioBuffer(): AudioBuffer {
    return this.buffer;
  }

  get soloed(): boolean {
    return this._soloed;
  }

  set soloed(s: boolean) {
    this._soloed = s;
  }

  /** Call after any solo/mute/volume change — computes final gain from all factors */
  applyEffectiveGain(params: {
    anySoloActive: boolean;
    stemAudibleBySolo: boolean;
    groupVolume: number;
    groupMuted: boolean;
  }): void {
    if (this._muted || params.groupMuted) {
      this.setGain(0);
    } else if (params.anySoloActive && !params.stemAudibleBySolo) {
      this.setGain(0);
    } else {
      this.setGain(this._userVolume * params.groupVolume);
    }
  }

  /** What this stem currently contributes to the mix, before pan and master */
  get effectiveGain(): number {
    return this._effectiveGain;
  }

  private setGain(g: number): void {
    this._effectiveGain = g;
    this.gainNode.gain.value = g;
  }

  private updateGain(): void {
    // Simple update without solo logic — full recalc happens via applyEffectiveGain
    this.setGain(this._muted ? 0 : this._userVolume);
  }

  disconnect(): void {
    this.stop();
    this.segment = null;
    this.monoMixer.disconnect();
    this.gainNode.disconnect();
    this.panNode.disconnect();
  }
}

function sameRegion(a: LoopRegion, b: LoopRegion): boolean {
  return a.start === b.start && a.end === b.end;
}
