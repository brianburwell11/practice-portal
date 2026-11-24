import type { LoopRegion } from './StemPlayer';

export class TransportClock {
  private ctx: AudioContext;
  private _playing = false;
  private contextTimeAtPlay = 0;
  private songTimeAtPlay = 0;
  private _duration = 0;
  private _tempoRatio = 1.0;
  private loop: LoopRegion | null = null;
  /** True right after play or seek: the shifted clock holds at the start
   *  point until the first sound reaches the ear. False after a rebase
   *  (tempo or loop change), where earlier audio is still in the pipe. */
  private freshStart = true;
  private getOutputLatency: () => number;

  /** `getOutputLatency` returns seconds between the audio clock and the ear
   *  (Bluetooth headphones add 150 to 250 ms). */
  constructor(ctx: AudioContext, getOutputLatency: () => number = () => 0) {
    this.ctx = ctx;
    this.getOutputLatency = getOutputLatency;
  }

  /** Follow a replacement context (the old one stalled). Call while paused: the position carries over. */
  setContext(ctx: AudioContext): void {
    this.pause();
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
      this.freshStart = false;
    }
    this._tempoRatio = ratio;
  }

  /** Match the A/B loop the audio is playing, so the position wraps with it */
  setLoop(loop: LoopRegion | null): void {
    if (this._playing) {
      this.songTimeAtPlay = this.currentTime;
      this.contextTimeAtPlay = this.ctx.currentTime;
      this.freshStart = false;
    }
    this.loop = loop;
  }

  /** Song position the audio is being scheduled at, in seconds. Drives
   *  playback, seeking and looping. */
  get currentTime(): number {
    return this.positionAt(this.ctx.currentTime);
  }

  /** Song position the listener is hearing right now: `currentTime` minus
   *  the output latency. Drives visuals and anything stamped by ear. */
  get audibleTime(): number {
    return this.positionAt(this.ctx.currentTime - this.getOutputLatency());
  }

  private positionAt(contextTime: number): number {
    if (!this._playing) return this.songTimeAtPlay;
    const elapsed = (contextTime - this.contextTimeAtPlay) * this._tempoRatio;
    // Nothing audible yet since play or seek: hold at the start point
    if (elapsed < 0 && this.freshStart) return this.songTimeAtPlay;
    let pos = this.songTimeAtPlay + elapsed;
    const loop = this.loop;
    if (loop && this.songTimeAtPlay < loop.end && pos >= loop.end) {
      pos = loop.start + (pos - loop.start) % (loop.end - loop.start);
    }
    return Math.max(0, Math.min(pos, this._duration));
  }

  play(): void {
    if (this._playing) return;
    this.contextTimeAtPlay = this.ctx.currentTime;
    this.freshStart = true;
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
      this.freshStart = true;
    }
  }
}
