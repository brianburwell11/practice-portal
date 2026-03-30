export class TransportClock {
  private ctx: AudioContext;
  private _playing = false;
  private contextTimeAtPlay = 0;
  private songTimeAtPlay = 0;
  private _duration = 0;

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

  /** Current song position in seconds */
  get currentTime(): number {
    if (!this._playing) return this.songTimeAtPlay;
    const elapsed = this.ctx.currentTime - this.contextTimeAtPlay;
    const pos = this.songTimeAtPlay + elapsed;
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
