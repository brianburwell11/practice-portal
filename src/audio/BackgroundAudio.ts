/**
 * Keeps playback going when the app is in the background on iOS.
 *
 * iOS stops a page that only uses Web Audio as soon as it leaves the
 * foreground, but it lets a playing <audio> element carry on. So on iOS the
 * engine's output is sent into a MediaStream that a hidden <audio> element
 * plays, instead of straight to the speakers. Everywhere else the output goes
 * to ctx.destination as before.
 *
 * It also tells the OS this is media playback (Audio Session API) and fills in
 * the lock screen / Control Center controls (Media Session API).
 */

const isIOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

/** Safari 16.4+. Not in the TS DOM lib yet. */
type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } };

export interface MediaControls {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** Current position and length, for the lock screen scrubber. */
  position(): { currentTime: number; duration: number };
}

export class BackgroundAudio {
  private ctx: AudioContext;
  private output: AudioNode;
  private element: HTMLAudioElement | null = null;

  constructor(ctx: AudioContext, output: AudioNode) {
    this.ctx = ctx;
    this.output = output;

    const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
    if (audioSession) audioSession.type = 'playback';

    if (isIOS && typeof ctx.createMediaStreamDestination === 'function') {
      const streamDest = ctx.createMediaStreamDestination();
      output.connect(streamDest);
      const el = document.createElement('audio');
      el.srcObject = streamDest.stream;
      el.setAttribute('playsinline', '');
      el.hidden = true;
      document.body.appendChild(el);
      this.element = el;
    } else {
      output.connect(ctx.destination);
    }
  }

  /** Call synchronously inside the user's tap, before any await, so iOS allows it. */
  start(): void {
    const el = this.element;
    if (!el) return;
    el.play().catch(() => {
      // The element wasn't allowed to play: fall back to direct output so
      // playback still works in the foreground.
      this.output.connect(this.ctx.destination);
      el.remove();
      this.element = null;
    });
  }

  stop(): void {
    this.element?.pause();
  }

  setMetadata(title: string, artist: string): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: [{ src: `${import.meta.env.BASE_URL}apple-touch-icon.png`, sizes: '180x180', type: 'image/png' }],
    });
  }

  setControls(controls: MediaControls): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => controls.play()],
      ['pause', () => controls.pause()],
      ['seekto', (d) => { if (d.seekTime !== undefined) controls.seek(d.seekTime); }],
      ['seekbackward', (d) => controls.seek(Math.max(0, controls.position().currentTime - (d.seekOffset ?? 10)))],
      ['seekforward', (d) => controls.seek(controls.position().currentTime + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser
      }
    }
  }

  /** Mirror the transport state onto the lock screen. */
  update(playing: boolean, currentTime: number, duration: number, rate: number): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(Math.max(0, currentTime), duration),
          playbackRate: rate,
        });
      } catch {
        // Older Safari rejects position state
      }
    }
  }

  dispose(): void {
    this.element?.pause();
    this.element?.remove();
    this.element = null;
  }
}
