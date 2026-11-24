import type { SongConfig, StemConfig, StemGroupConfig } from './types';
import { TransportClock } from './TransportClock';
import { StemPlayer, type LoopRegion } from './StemPlayer';
import { SoundTouchFallbackNode } from './SoundTouchFallbackNode';
import { BackgroundAudio } from './BackgroundAudio';
import { PEAKS_PER_SECOND, computeStemEnvelope, maxOf, mixEnvelopes } from './mixPeaks';
import { stemUrl } from './mediaUrls';

/** Common interface for both AudioWorklet and ScriptProcessorNode pitch correction paths */
interface PitchCorrectorNode {
  readonly audioNode: AudioNode;
  setPlaybackRate(rate: number): void;
  connect(dest: AudioNode): void;
  disconnect(): void;
}

const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
const isMobile = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod|Android/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);
const MOBILE_SAMPLE_RATE = 22050;

interface GroupState {
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export type EngineStateCallback = () => void;

export class AudioEngine {
  private ctx: AudioContext;
  readonly clock: TransportClock;
  masterGain: GainNode;
  private mixBus: GainNode;
  private pitchNode: PitchCorrectorNode | null = null;
  private _tempoRatio = 1.0;
  private stems: Map<string, StemPlayer> = new Map();
  /** Stems deferred for lazy decode — stored as raw ArrayBuffer until unmuted */
  private pendingStems: Map<string, { config: StemConfig; arrayBuffer: ArrayBuffer }> = new Map();
  private _songConfig: SongConfig | null = null;
  /** The live mix's waveform: peak amplitude (0..1) per bucket, in song time */
  private _peakData: Float32Array | null = null;
  /** Each decoded stem's envelope, in its own time */
  private stemEnvelopes: Map<string, Float32Array> = new Map();
  /** Fixed per song so turning stems down shrinks the waveform rather than re-normalizing it */
  private peakScale = 0;
  private _peaksVersion = 0;
  private onStateChange: EngineStateCallback | null = null;
  private animFrameId: number | null = null;
  private groupConfigs: StemGroupConfig[] = [];
  private groupStates: Map<string, GroupState> = new Map();
  /** Maps stem id → group id (if the stem belongs to a group) */
  private stemToGroup: Map<string, string> = new Map();
  private workletRegistered = false;
  private _loopA: number | null = null;
  private _loopB: number | null = null;
  private _loopEnabled = true;
  private wakeLock: WakeLockSentinel | null = null;
  private background: BackgroundAudio;
  /** The listener's manual correction on top of what the browser reports, in seconds */
  private latencyAdjust = 0;
  /** The context stopped running and won't start again (phones do this to a page left in
   *  the background): the next play replaces it. */
  private stale = false;
  /** A play in progress, so repeated taps don't start the stems twice */
  private starting: Promise<void> | null = null;
  /** For spotting a stalled clock while playing: its last reading and when it changed */
  private lastCtxTime = 0;
  private lastCtxChange = 0;
  private onPageShown = () => {
    if (document.visibilityState === 'visible') this.checkContext();
  };

  constructor() {
    this.ctx = new AudioContext();
    this.clock = new TransportClock(this.ctx, () => this.outputLatencySeconds);
    this.masterGain = this.ctx.createGain();
    this.background = this.createBackground();
    // Mix bus: all stems connect here, single SoundTouch node sits between mixBus and masterGain
    this.mixBus = this.ctx.createGain();
    this.watchContext();

    // Back from the background: make sure the audio clock came back with the page
    document.addEventListener('visibilitychange', this.onPageShown);
    window.addEventListener('pageshow', this.onPageShown);
  }

  /** Speakers directly, or on iOS through an <audio> element so playback survives backgrounding */
  private createBackground(): BackgroundAudio {
    const background = new BackgroundAudio(this.ctx, this.masterGain);
    background.setControls({
      play: () => { this.play(); },
      pause: () => this.pause(),
      seek: (seconds) => { this.seek(Math.min(Math.max(0, seconds), this.clock.duration)); },
      position: () => ({ currentTime: this.clock.currentTime, duration: this.clock.duration }),
    });
    if (this._songConfig) background.setMetadata(this._songConfig.title, this._songConfig.artist);
    return background;
  }

  /** When the OS interrupts the AudioContext (screen lock, another app), stop our playback state to match */
  private watchContext(): void {
    const ctx = this.ctx;
    ctx.addEventListener('statechange', () => {
      if (ctx === this.ctx && ctx.state !== 'running' && this.clock.playing) {
        this.pause();
      }
    });
  }

  /**
   * After the page comes back to the foreground. A phone can hand back a
   * context that says it's running but whose clock no longer moves: nothing
   * plays and the playhead never leaves its spot. Spot that, and replace the
   * context on the next play.
   */
  private checkContext(): void {
    // The stall check while playing measures from now, not from before the page was hidden
    this.lastCtxChange = performance.now();
    const ctx = this.ctx;
    if (ctx.state !== 'running') return; // play() resumes it, or replaces it if it won't
    const before = ctx.currentTime;
    setTimeout(() => {
      if (ctx !== this.ctx || ctx.state !== 'running' || document.visibilityState !== 'visible') return;
      if (ctx.currentTime === before) this.markStalled();
    }, 500);
  }

  private markStalled(): void {
    this.stale = true;
    this.pause();
  }

  /**
   * Swap in a new AudioContext and rebuild the graph on it, keeping the song:
   * decoded stems (AudioBuffers work in any context), mixer settings, tempo,
   * loop and position. Best called inside the user's tap, so the new context
   * is allowed to start.
   */
  private replaceContext(): void {
    this.pause();
    const old = this.ctx;
    const volume = this.masterGain.gain.value;
    const kept = Array.from(this.stems);
    for (const stem of this.stems.values()) stem.disconnect();
    if (this.pitchNode) {
      this.pitchNode.disconnect();
      this.pitchNode = null;
    }
    this.background.dispose();
    void old.close().catch(() => {});

    this.ctx = new AudioContext();
    this.clock.setContext(this.ctx);
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = volume;
    this.mixBus = this.ctx.createGain();
    this.background = this.createBackground();
    this.workletRegistered = false;
    this.watchContext();

    const loop = this.loopRegion();
    for (const [id, stem] of kept) {
      const player = new StemPlayer(this.ctx, stem.audioBuffer, this.mixBus, stem.volume, stem.pan, stem.offsetSec);
      player.stereo = stem.stereo;
      player.muted = stem.muted;
      player.soloed = stem.soloed;
      player.setTempo(this._tempoRatio);
      player.setLoop(loop);
      this.stems.set(id, player);
    }
    this.recalcAllGains();
    this.stale = false;
    this.notify();
  }

  /** Output delay the browser reports for the current device, in seconds.
   *  Includes Bluetooth where the OS knows about it (Chrome on macOS does);
   *  0 where the browser reports nothing. Changes when headphones connect,
   *  so read it live. */
  get detectedLatencySeconds(): number {
    const out = this.ctx.outputLatency;
    const base = this.ctx.baseLatency;
    return (Number.isFinite(out) ? out : 0) + (Number.isFinite(base) ? base : 0);
  }

  /** Total delay between the audio clock and the ear: detected plus the manual adjustment */
  get outputLatencySeconds(): number {
    return Math.max(0, this.detectedLatencySeconds + this.latencyAdjust);
  }

  /** The listener's correction to the detected latency, in milliseconds */
  setLatencyAdjustMs(ms: number): void {
    this.latencyAdjust = ms / 1000;
  }

  /** Get ready to play calibration clicks: pauses the song and opens the
   *  output. Call synchronously inside the user's tap, so iOS allows it. */
  async beginCalibration(): Promise<void> {
    this.pause();
    this.background.start();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    // A fresh pitch node, so the clicks take the song's path with no
    // leftover song audio buffered inside it
    if (this.stems.size > 0) await this.connectPitchNode();
  }

  /** Close the output opened by beginCalibration, unless the song is playing again */
  endCalibration(): void {
    if (!this.clock.playing) this.background.stop();
  }

  /** A metronome click at `when` (audio clock seconds), routed through the
   *  song's path so it picks up the same output delay. Returns a cancel. */
  scheduleClick(when: number, accent = false): () => void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    osc.connect(gain);
    gain.connect(this.pitchNode ? this.mixBus : this.masterGain);
    osc.start(when);
    osc.stop(when + 0.04);
    osc.onended = () => gain.disconnect();
    return () => {
      try { osc.stop(); } catch { /* already stopped */ }
      gain.disconnect();
    };
  }

  get songConfig(): SongConfig | null {
    return this._songConfig;
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  get peakData(): Float32Array | null {
    return this._peakData;
  }

  get peaksPerSecond(): number {
    return PEAKS_PER_SECOND;
  }

  /** Changes whenever peakData does */
  get peaksVersion(): number {
    return this._peaksVersion;
  }

  get loopA(): number | null {
    return this._loopA;
  }

  get loopB(): number | null {
    return this._loopB;
  }

  get loopEnabled(): boolean {
    return this._loopEnabled;
  }

  setOnStateChange(cb: EngineStateCallback): void {
    this.onStateChange = cb;
  }

  private notify(): void {
    this.onStateChange?.();
  }

  private async ensureWorkletRegistered(): Promise<void> {
    if (!hasAudioWorklet || this.workletRegistered) return;
    const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
    await SoundTouchNode.register(
      this.ctx,
      `${import.meta.env.BASE_URL}soundtouch-processor.js`,
    );
    this.workletRegistered = true;
  }

  async loadSong(
    config: SongConfig,
    basePath: string,
    onProgress?: (loaded: number, total: number) => void,
    stemFiles?: Map<string, File>,
  ): Promise<void> {
    // Clear any active loop and stop current playback
    this.clearLoop();
    this.stop();
    this.disposeStemPlayers();

    // Register SoundTouch AudioWorklet processor (once)
    await this.ensureWorkletRegistered();

    // Create shared pitch corrector: mixBus → pitchNode → masterGain
    await this.connectPitchNode();

    this._songConfig = config;
    this.clock.duration = config.durationSeconds;
    this.background.setMetadata(config.title, config.artist);

    // Fetch all stems, but only decode audible ones (lazy decode for muted stems)
    const total = config.stems.length;
    let loaded = 0;
    this.pendingStems.clear();

    const fetched = await Promise.all(
      config.stems.map(async (stemConfig: StemConfig) => {
        let arrayBuffer: ArrayBuffer;
        const localFile = stemFiles?.get(stemConfig.id);
        if (localFile) {
          arrayBuffer = await localFile.arrayBuffer();
        } else {
          const response = await fetch(stemUrl(basePath, stemConfig.file, config.mediaVersions));
          arrayBuffer = await response.arrayBuffer();
        }
        loaded++;
        onProgress?.(loaded, total);
        return { config: stemConfig, arrayBuffer };
      }),
    );

    // Decode audible stems now, defer muted ones. Decodes run off the main
    // thread, so they overlap: all at once on desktop, two at a time on phones
    // to cap peak memory. Each envelope is computed as its decode lands.
    const audible = fetched.filter(({ config: c, arrayBuffer }) => {
      if (c.defaultVolume !== 0) return true;
      this.pendingStems.set(c.id, { config: c, arrayBuffer });
      return false;
    });
    const decoded: { audioBuffer: AudioBuffer; envelope: Float32Array }[] = new Array(audible.length);
    let next = 0;
    const decodeWorker = async () => {
      while (next < audible.length) {
        const i = next++;
        const audioBuffer = await this.decodeAudio(audible[i].arrayBuffer);
        decoded[i] = { audioBuffer, envelope: computeStemEnvelope(audioBuffer) };
      }
    };
    const decodeConcurrency = isMobile ? 2 : audible.length;
    await Promise.all(Array.from({ length: Math.min(decodeConcurrency, audible.length) }, decodeWorker));

    // Build players in config order
    for (let i = 0; i < audible.length; i++) {
      const stemConfig = audible[i].config;
      const { audioBuffer, envelope } = decoded[i];
      const player = new StemPlayer(
        this.ctx,
        audioBuffer,
        this.mixBus,
        stemConfig.defaultVolume,
        stemConfig.defaultPan,
        stemConfig.offsetSec ?? 0,
      );
      if (stemConfig.stereo) {
        player.stereo = true;
      }
      this.stems.set(stemConfig.id, player);
      this.stemEnvelopes.set(stemConfig.id, envelope);
    }

    // Initialize group state
    this.groupConfigs = config.groups ?? [];
    this.groupStates.clear();
    this.stemToGroup.clear();
    for (const group of this.groupConfigs) {
      this.groupStates.set(group.id, { volume: 1, muted: false, soloed: false });
      for (const stemId of group.stemIds) {
        this.stemToGroup.set(stemId, group.id);
      }
    }

    this.peakScale = 0;
    this.refreshPeaks();
    this.notify();
  }

  play(): Promise<void> {
    if (this.clock.playing || this.stems.size === 0) return Promise.resolve();
    this.starting ??= this.startPlaying().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async startPlaying(): Promise<void> {
    // A context that stopped working is replaced here, inside the user's tap, where the new one may start
    if (this.stale || this.ctx.state === 'closed') this.replaceContext();

    // Must happen before the first await, while we're still inside the user's tap
    this.background.start();

    // Resume AudioContext if not running (suspended by autoplay policy, or interrupted by screen lock).
    // A context the phone won't give back never answers, so don't wait on it for long.
    if (this.ctx.state !== 'running' && !(await resumed(this.ctx))) {
      // Try a fresh one. Android still counts this as the tap; if iOS doesn't, the next tap starts it.
      this.replaceContext();
      this.background.start();
      if (!(await resumed(this.ctx))) {
        this.stale = true;
        this.background.stop();
        return;
      }
    }

    // Register the SoundTouch processor on a replaced context (once per context)
    await this.ensureWorkletRegistered();
    // Recreate pitch corrector to flush internal buffers from previous playback
    await this.connectPitchNode();
    if (this.clock.playing) return;

    // Starting past the loop's end plays the loop from A
    const loop = this.loopRegion();
    if (loop && this.clock.currentTime >= loop.end) {
      this.clock.seek(loop.start);
    }

    const offset = this.clock.currentTime;
    const when = this.ctx.currentTime + 0.01; // tiny future offset for sync

    this.clock.play();

    for (const stem of this.stems.values()) {
      stem.start(when, offset);
    }

    this.startPositionUpdates();
    this.acquireWakeLock();
    this.syncMediaSession();
    this.notify();
  }

  pause(): void {
    if (!this.clock.playing) return;
    this.clock.pause();

    for (const stem of this.stems.values()) {
      stem.stop();
    }

    this.stopPositionUpdates();
    this.releaseWakeLock();
    this.background.stop();
    this.syncMediaSession();
    this.notify();
  }

  stop(): void {
    this.clock.stop();

    for (const stem of this.stems.values()) {
      stem.stop();
    }

    this.stopPositionUpdates();
    this.releaseWakeLock();
    this.background.stop();
    this.syncMediaSession();
    this.notify();
  }

  async seek(seconds: number): Promise<void> {
    const wasPlaying = this.clock.playing;

    // While playing a loop, seeking past its end plays the loop from A
    const loop = this.loopRegion();
    if (wasPlaying && loop && seconds >= loop.end) {
      seconds = loop.start;
    }

    if (wasPlaying) {
      for (const stem of this.stems.values()) {
        stem.stop();
      }
    }

    this.clock.seek(seconds);

    if (wasPlaying) {
      // Recreate pitch corrector to flush internal buffers
      await this.connectPitchNode();
      const when = this.ctx.currentTime + 0.01;
      for (const stem of this.stems.values()) {
        stem.start(when, seconds);
      }
    }

    this.syncMediaSession();
    this.notify();
  }

  getStem(id: string): StemPlayer | undefined {
    return this.stems.get(id);
  }

  getAllStems(): Map<string, StemPlayer> {
    return this.stems;
  }

  setMasterVolume(v: number): void {
    this.masterGain.gain.value = v;
    this.notify();
  }

  setTempo(ratio: number): void {
    this._tempoRatio = ratio;
    this.clock.setTempoRatio(ratio);
    // Pitch correction on the shared bus
    if (this.pitchNode) {
      this.pitchNode.setPlaybackRate(ratio);
    }
    // Native playbackRate on each source (free, drives speed)
    for (const stem of this.stems.values()) {
      stem.setTempo(ratio);
    }
    this.syncMediaSession();
    this.notify();
  }

  setStemVolume(id: string, v: number): void {
    // Lazy decode: if raising volume on a pending stem, decode it now
    if (v > 0 && this.pendingStems.has(id)) {
      this.decodePendingStem(id);
      return;
    }
    const stem = this.stems.get(id);
    if (stem) {
      stem.volume = v;
      this.recalcAllGains();
      this.notify();
    }
  }

  setStemPan(id: string, v: number): void {
    const stem = this.stems.get(id);
    if (stem) {
      stem.pan = v;
      this.notify();
    }
  }

  setStemMuted(id: string, muted: boolean): void {
    // Lazy decode: if unmuting a pending stem, decode it now
    if (!muted && this.pendingStems.has(id)) {
      this.decodePendingStem(id);
      return;
    }
    const stem = this.stems.get(id);
    if (stem) {
      stem.muted = muted;
      this.recalcAllGains();
      this.notify();
    }
  }

  setStemSoloed(id: string, soloed: boolean): void {
    const stem = this.stems.get(id);
    if (stem) {
      stem.soloed = soloed;
      this.recalcAllGains();
      this.notify();
    }
  }

  setStemStereo(id: string, stereo: boolean): void {
    const stem = this.stems.get(id);
    if (stem) {
      stem.stereo = stereo;
      this.notify();
    }
  }

  setGroupVolume(groupId: string, v: number): void {
    const gs = this.groupStates.get(groupId);
    if (gs) {
      gs.volume = v;
      this.recalcAllGains();
      this.notify();
    }
  }

  setGroupMuted(groupId: string, muted: boolean): void {
    const gs = this.groupStates.get(groupId);
    if (gs) {
      gs.muted = muted;
      this.recalcAllGains();
      this.notify();
    }
  }

  setGroupSoloed(groupId: string, soloed: boolean): void {
    const gs = this.groupStates.get(groupId);
    if (gs) {
      gs.soloed = soloed;
      this.recalcAllGains();
      this.notify();
    }
  }

  private recalcAllGains(): void {
    // Determine if any solo is active (stem-level or group-level)
    const anyGroupSoloed = Array.from(this.groupStates.values()).some((g) => g.soloed);
    const anyStemSoloed = Array.from(this.stems.values()).some((s) => s.soloed);
    const anySoloActive = anyGroupSoloed || anyStemSoloed;

    for (const [stemId, stem] of this.stems) {
      const groupId = this.stemToGroup.get(stemId);
      const gs = groupId ? this.groupStates.get(groupId) : undefined;

      // Is this stem audible by solo logic?
      let stemAudibleBySolo = false;
      if (stem.soloed) {
        stemAudibleBySolo = true;
      } else if (gs?.soloed) {
        // Group is soloed — all non-muted children play
        stemAudibleBySolo = true;
      } else if (!anySoloActive) {
        stemAudibleBySolo = true;
      }

      stem.applyEffectiveGain({
        anySoloActive,
        stemAudibleBySolo,
        groupVolume: gs?.volume ?? 1,
        groupMuted: gs?.muted ?? false,
      });
    }
    this.refreshPeaks();
  }

  /** Rebuild the waveform from each stem's current gain and offset. Master volume is left out. */
  private refreshPeaks(): void {
    const mix = (unity: boolean) =>
      mixEnvelopes(
        Array.from(this.stems, ([id, stem]) => ({
          env: this.stemEnvelopes.get(id) ?? new Float32Array(0),
          offsetSec: stem.offsetSec,
          gain: unity ? 1 : stem.effectiveGain,
        })),
        this.clock.duration,
      );

    const peaks = mix(false);
    if (this.peakScale === 0) {
      // First draw for this song: let its starting mix fill the height
      const max = maxOf(peaks) || maxOf(mix(true));
      if (max > 0) this.peakScale = 0.95 / max;
    }
    for (let i = 0; i < peaks.length; i++) peaks[i] = Math.min(1, peaks[i] * this.peakScale);
    this._peakData = peaks;
    this._peaksVersion++;
  }

  /** Decode a deferred stem, create its StemPlayer, and join playback if active */
  private async decodePendingStem(id: string): Promise<void> {
    const pending = this.pendingStems.get(id);
    if (!pending) return;
    this.pendingStems.delete(id);

    const audioBuffer = await this.decodeAudio(pending.arrayBuffer);
    const player = new StemPlayer(
      this.ctx,
      audioBuffer,
      this.mixBus,
      pending.config.defaultVolume,
      pending.config.defaultPan,
      pending.config.offsetSec ?? 0,
    );
    if (pending.config.stereo) {
      player.stereo = true;
    }
    this.stems.set(id, player);
    this.stemEnvelopes.set(id, computeStemEnvelope(audioBuffer));
    player.setLoop(this.loopRegion());

    // If currently playing, start the new stem at the current position
    if (this.clock.playing) {
      const when = this.ctx.currentTime + 0.01;
      player.setTempo(this._tempoRatio);
      player.start(when, this.clock.currentTime);
    }

    this.recalcAllGains();
    this.notify();
  }

  /** Decode audio, downsampling to 22,050 Hz on mobile to halve memory usage */
  private async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    if (!isMobile) {
      return this.ctx.decodeAudioData(arrayBuffer);
    }
    // Decode at low sample rate via OfflineAudioContext — the main context
    // resamples transparently when the buffer is connected to the graph
    const offlineCtx = new OfflineAudioContext(1, 1, MOBILE_SAMPLE_RATE);
    return offlineCtx.decodeAudioData(arrayBuffer);
  }

  /** (Re)create the shared pitch corrector: mixBus → pitchNode → masterGain */
  private acquireWakeLock(): void {
    if (this.wakeLock || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(
      (lock) => { this.wakeLock = lock; },
      () => {},
    );
  }

  private syncMediaSession(): void {
    this.background.update(this.clock.playing, this.clock.currentTime, this.clock.duration, this._tempoRatio);
  }

  private releaseWakeLock(): void {
    if (!this.wakeLock) return;
    this.wakeLock.release().catch(() => {});
    this.wakeLock = null;
  }

  private async connectPitchNode(): Promise<void> {
    if (this.pitchNode) {
      this.mixBus.disconnect();
      this.pitchNode.disconnect();
    }

    let node: PitchCorrectorNode;
    if (hasAudioWorklet) {
      const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
      const stNode = new SoundTouchNode(this.ctx);
      node = {
        audioNode: stNode,
        setPlaybackRate: (rate) => { stNode.playbackRate.value = rate; },
        connect: (dest) => stNode.connect(dest),
        disconnect: () => stNode.disconnect(),
      };
    } else {
      const fallback = new SoundTouchFallbackNode(this.ctx);
      node = fallback;
    }

    node.setPlaybackRate(this._tempoRatio);
    this.mixBus.connect(node.audioNode);
    node.connect(this.masterGain);
    this.pitchNode = node;
  }

  private disposeStemPlayers(): void {
    for (const stem of this.stems.values()) {
      stem.disconnect();
    }
    this.stems.clear();
    this.pendingStems.clear();
    this.stemEnvelopes.clear();
    this._peakData = null;
    this._peaksVersion++;
    if (this.pitchNode) {
      this.mixBus.disconnect();
      this.pitchNode.disconnect();
      this.pitchNode = null;
    }
  }

  private startPositionUpdates(): void {
    this.stopPositionUpdates();
    this.lastCtxTime = this.ctx.currentTime;
    this.lastCtxChange = performance.now();
    const tick = () => {
      // The audio clock stopped moving while we're on screen: the context died under us
      const now = performance.now();
      if (this.ctx.currentTime !== this.lastCtxTime) {
        this.lastCtxTime = this.ctx.currentTime;
        this.lastCtxChange = now;
      } else if (now - this.lastCtxChange > 1500 && document.visibilityState === 'visible') {
        this.markStalled();
        return;
      }
      // Check if playback reached the end
      if (!(this._loopEnabled && this._loopA !== null && this._loopB !== null) && this.clock.currentTime >= this.clock.duration) {
        this.stop();
        return;
      }
      this.notify();
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopPositionUpdates(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  setLoop(a: number | null, b: number | null): void {
    if (a !== null && b !== null) {
      // Auto-swap if a > b
      if (a > b) {
        [a, b] = [b, a];
      }
      // Enforce minimum 0.1s loop length
      if (b - a < 0.1) {
        return;
      }
    }
    this._loopA = a;
    this._loopB = b;
    this._loopEnabled = true;
    this.applyLoop();
    this.notify();
  }

  setLoopEnabled(enabled: boolean): void {
    this._loopEnabled = enabled;
    this.applyLoop();
    this.notify();
  }

  clearLoop(): void {
    this._loopA = null;
    this._loopB = null;
    this._loopEnabled = true;
    this.applyLoop();
    this.notify();
  }

  /**
   * The loop the audio should play, or null. Both ends are snapped to the
   * stems' sample grid so every stem wraps on the same frame.
   */
  private loopRegion(): LoopRegion | null {
    if (!this._loopEnabled || this._loopA === null || this._loopB === null) return null;
    const first = this.stems.values().next().value;
    const rate = first?.audioBuffer.sampleRate ?? this.ctx.sampleRate;
    return { start: Math.round(this._loopA * rate) / rate, end: Math.round(this._loopB * rate) / rate };
  }

  /** Hand the current loop to the clock and every stem. Call whenever A, B or the loop toggle changes. */
  private applyLoop(): void {
    const loop = this.loopRegion();
    this.clock.setLoop(loop);
    let restart = false;
    for (const stem of this.stems.values()) {
      if (!stem.setLoop(loop)) restart = true;
    }
    if (!this.clock.playing) return;
    if (loop && this.clock.currentTime >= loop.end) {
      this.seek(loop.start);
    } else if (restart) {
      const when = this.ctx.currentTime + 0.01;
      for (const stem of this.stems.values()) {
        stem.start(when, this.clock.currentTime);
      }
    }
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onPageShown);
    window.removeEventListener('pageshow', this.onPageShown);
    this.stop();
    this.disposeStemPlayers();
    this.background.dispose();
    this.ctx.close();
  }
}

/** Ask a context to run again. False if it isn't running within `ms` (a phone that won't give it back). */
async function resumed(ctx: AudioContext, ms = 1500): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  await Promise.race([ctx.resume().catch(() => {}), timeout]);
  clearTimeout(timer);
  return ctx.state === 'running';
}
