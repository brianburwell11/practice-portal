export class StemPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  readonly gainNode: GainNode;
  readonly panNode: StereoPannerNode;
  private _muted = false;
  private _soloed = false;
  private _userVolume: number;

  constructor(
    ctx: AudioContext,
    buffer: AudioBuffer,
    masterGain: GainNode,
    defaultVolume: number,
    defaultPan: number,
  ) {
    this.ctx = ctx;
    this.buffer = buffer;
    this._userVolume = defaultVolume;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = defaultVolume;

    this.panNode = ctx.createStereoPanner();
    this.panNode.pan.value = defaultPan;

    // Chain: gain → pan → master
    this.gainNode.connect(this.panNode);
    this.panNode.connect(masterGain);
  }

  /** Start playback at a precise AudioContext time from a song offset */
  start(when: number, offset: number): void {
    this.stop();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gainNode);
    this.source.start(when, offset);
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
    return this.panNode.pan.value;
  }

  set pan(v: number) {
    this.panNode.pan.value = v;
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
    this.gainNode.disconnect();
    this.panNode.disconnect();
  }
}
