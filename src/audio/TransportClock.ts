import type { LoopRegion } from './StemPlayer';

export class TransportClock {
  private ctx: AudioContext;
  private _playing = false;
  private contextTimeAtPlay = 0;
  private songTimeAtPlay = 0;
  private _duration = 0;
  private _tempoRatio = 1.0;
  private loop: LoopRegion | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get playing(): boolean {
    return this._playing;
  }

  get duration(): number {
    return this._duration;
  }

  set duration(d: number) {
    this._duration = d;
  }

  get tempoRatio(): number {
    return this._tempoRatio;
  }

  setTempoRatio(ratio: number): void {
    if (this._playing) {
      this.songTimeAtPlay = this.currentTime;
      this.contextTimeAtPlay = this.ctx.currentTime;
    }
    this._tempoRatio = ratio;
  }

  /** Match the A/B loop the audio is playing, so the position wraps with it */
  setLoop(loop: LoopRegion | null): void {
    if (this._playing) {
      this.songTimeAtPlay = this.currentTime;
      this.contextTimeAtPlay = this.ctx.currentTime;
    }
    this.loop = loop;
  }

  /** Current song position in seconds */
  get currentTime(): number {
    if (!this._playing) return this.songTimeAtPlay;
    const elapsed = (this.ctx.currentTime - this.contextTimeAtPlay) * this._tempoRatio;
    let pos = this.songTimeAtPlay + elapsed;
    const loop = this.loop;
    if (loop && this.songTimeAtPlay < loop.end && pos >= loop.end) {
      pos = loop.start + (pos - loop.start) % (loop.end - loop.start);
    }
    return Math.min(pos, this._duration);
  }

  play(): void {
    if (this._playing) return;
    this.contextTimeAtPlay = this.ctx.currentTime;
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.songTimeAtPlay = this.currentTime;
    this._playing = false;
  }

  stop(): void {
    this._playing = false;
    this.songTimeAtPlay = 0;
  }

  seek(seconds: number): void {
    const clamped = Math.max(0, Math.min(seconds, this._duration));
    this.songTimeAtPlay = clamped;
    if (this._playing) {
      this.contextTimeAtPlay = this.ctx.currentTime;
    }
  }
}
