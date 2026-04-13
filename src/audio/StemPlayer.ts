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

    const stemPos = globalPos - this._offsetSec;
    if (stemPos >= this.buffer.duration) return; // already past the end of this stem

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this._tempoRatio;
    this.source.connect(this.monoMixer);

    if (stemPos >= 0) {
      this.source.start(when, stemPos);
    } else {
      // Delay start until globalPos reaches offsetSec
      this.source.start(when + -stemPos, 0);
    }
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
      this.gainNode.gain.value = 0;
    } else if (params.anySoloActive && !params.stemAudibleBySolo) {
      this.gainNode.gain.value = 0;
    } else {
      this.gainNode.gain.value = this._userVolume * params.groupVolume;
    }
  }

  private updateGain(): void {
    // Simple update without solo logic — full recalc happens via applyEffectiveGain
    if (this._muted) {
      this.gainNode.gain.value = 0;
    } else {
      this.gainNode.gain.value = this._userVolume;
    }
  }

  disconnect(): void {
    this.stop();
    this.monoMixer.disconnect();
    this.gainNode.disconnect();
    this.panNode.disconnect();
  }
}
