import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

export class StemPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  readonly gainNode: GainNode;
  readonly panNode: StereoPannerNode;
  private monoMixer: GainNode;
  private soundtouchNode: SoundTouchNode;
  private _tempoRatio = 1.0;
  private _muted = false;
  private _soloed = false;
  private _userVolume: number;
  private _userPan: number;

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
    this._userPan = defaultPan;

    this.soundtouchNode = new SoundTouchNode(ctx);

    // Mono mixer: downmixes stereo to mono by default
    this.monoMixer = ctx.createGain();
    this.monoMixer.channelCount = 1;
    this.monoMixer.channelCountMode = 'explicit';
    this.monoMixer.channelInterpretation = 'speakers';

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = defaultVolume;

    this.panNode = ctx.createStereoPanner();
    this.panNode.pan.value = defaultPan;

    // Chain: soundtouch → monoMixer → gain → pan → master
    this.soundtouchNode.connect(this.monoMixer);
    this.monoMixer.connect(this.gainNode);
    this.gainNode.connect(this.panNode);
    this.panNode.connect(masterGain);
  }

  /** Start playback at a precise AudioContext time from a song offset */
  start(when: number, offset: number): void {
    this.stop();

    // Recreate SoundTouchNode to flush internal buffers from previous playback
    this.soundtouchNode.disconnect();
    this.soundtouchNode = new SoundTouchNode(this.ctx);
    this.soundtouchNode.playbackRate.value = this._tempoRatio;
    this.soundtouchNode.connect(this.monoMixer);

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this._tempoRatio;
    this.source.connect(this.soundtouchNode);
    this.source.start(when, offset);
  }

  setTempo(ratio: number): void {
    this._tempoRatio = ratio;
    // Drive speed via source playbackRate; SoundTouch auto-corrects pitch
    if (this.source) {
      this.source.playbackRate.value = ratio;
    }
    this.soundtouchNode.playbackRate.value = ratio;
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
    this.soundtouchNode.disconnect();
    this.monoMixer.disconnect();
    this.gainNode.disconnect();
    this.panNode.disconnect();
  }
}
