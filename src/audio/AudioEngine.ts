import type { SongConfig, StemConfig, StemGroupConfig } from './types';
import { TransportClock } from './TransportClock';
import { StemPlayer } from './StemPlayer';
import { SoundTouchNode } from '@soundtouchjs/audio-worklet';

interface GroupState {
  volume: number;
  muted: boolean;
  soloed: boolean;
}

export type EngineStateCallback = () => void;

export class AudioEngine {
  private ctx: AudioContext;
  readonly clock: TransportClock;
  readonly masterGain: GainNode;
  private stems: Map<string, StemPlayer> = new Map();
  private _songConfig: SongConfig | null = null;
  private _peakData: Float32Array | null = null;
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
  private loopCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.clock = new TransportClock(this.ctx);
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
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
    if (this.workletRegistered) return;
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

    this._songConfig = config;
    this.clock.duration = config.durationSeconds;

    // Fetch and decode all stems in parallel
    const total = config.stems.length;
    let loaded = 0;

    const stemEntries = await Promise.all(
      config.stems.map(async (stemConfig: StemConfig) => {
        let arrayBuffer: ArrayBuffer;
        const localFile = stemFiles?.get(stemConfig.id);
        if (localFile) {
          arrayBuffer = await localFile.arrayBuffer();
        } else {
          const url = `${basePath}/${encodeURIComponent(stemConfig.file)}`;
          const response = await fetch(url);
          arrayBuffer = await response.arrayBuffer();
        }
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        loaded++;
        onProgress?.(loaded, total);
        return { config: stemConfig, buffer: audioBuffer };
      }),
    );

    for (const entry of stemEntries) {
      const player = new StemPlayer(
        this.ctx,
        entry.buffer,
        this.masterGain,
        entry.config.defaultVolume,
        entry.config.defaultPan,
      );
      if (entry.config.stereo) {
        player.stereo = true;
      }
      this.stems.set(entry.config.id, player);
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

    this._peakData = this.computeMergedPeaks(2048);
    this.notify();
  }

  play(): void {
    if (this.clock.playing || this.stems.size === 0) return;

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const offset = this.clock.currentTime;
    const when = this.ctx.currentTime + 0.01; // tiny future offset for sync

    this.clock.play();

    for (const stem of this.stems.values()) {
      stem.start(when, offset);
    }

    this.startPositionUpdates();
    if (this._loopEnabled && this._loopA !== null && this._loopB !== null) {
      this.startLoopScheduler();
    }
    this.notify();
  }

  pause(): void {
    if (!this.clock.playing) return;
    this.clock.pause();

    for (const stem of this.stems.values()) {
      stem.stop();
    }

    this.stopPositionUpdates();
    this.stopLoopScheduler();
    this.notify();
  }

  stop(): void {
    this.clock.stop();

    for (const stem of this.stems.values()) {
      stem.stop();
    }

    this.stopPositionUpdates();
    this.stopLoopScheduler();
    this.notify();
  }

  seek(seconds: number): void {
    const wasPlaying = this.clock.playing;

    if (wasPlaying) {
      for (const stem of this.stems.values()) {
        stem.stop();
      }
    }

    this.clock.seek(seconds);

    if (wasPlaying) {
      const when = this.ctx.currentTime + 0.01;
      for (const stem of this.stems.values()) {
        stem.start(when, seconds);
      }
    }

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
    this.clock.setTempoRatio(ratio);
    for (const stem of this.stems.values()) {
      stem.setTempo(ratio);
    }
    this.notify();
  }

  setStemVolume(id: string, v: number): void {
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
  }

  private computeMergedPeaks(bucketCount: number): Float32Array {
    const peaks = new Float32Array(bucketCount * 2); // interleaved [min, max, ...]

    // Find the longest buffer to determine total sample count
    let maxLength = 0;
    for (const stem of this.stems.values()) {
      maxLength = Math.max(maxLength, stem.audioBuffer.length);
    }
    if (maxLength === 0) return peaks;

    const samplesPerBucket = maxLength / bucketCount;

    for (let b = 0; b < bucketCount; b++) {
      let bucketMin = 0;
      let bucketMax = 0;
      const start = Math.floor(b * samplesPerBucket);
      const end = Math.floor((b + 1) * samplesPerBucket);

      for (const stem of this.stems.values()) {
        const buf = stem.audioBuffer;
        if (start >= buf.length) continue;
        const channels = buf.numberOfChannels;
        const sampleEnd = Math.min(end, buf.length);

        for (let ch = 0; ch < channels; ch++) {
          const data = buf.getChannelData(ch);
          for (let s = start; s < sampleEnd; s++) {
            const val = data[s] / channels; // average across channels
            if (val < bucketMin) bucketMin = val;
            if (val > bucketMax) bucketMax = val;
          }
        }
      }

      peaks[b * 2] = bucketMin;
      peaks[b * 2 + 1] = bucketMax;
    }

    return peaks;
  }

  private disposeStemPlayers(): void {
    for (const stem of this.stems.values()) {
      stem.disconnect();
    }
    this.stems.clear();
    this._peakData = null;
  }

  private startPositionUpdates(): void {
    this.stopPositionUpdates();
    const tick = () => {
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
    if (a !== null && b !== null && this.clock.playing) {
      this.startLoopScheduler();
    } else {
      this.stopLoopScheduler();
    }
    this.notify();
  }

  setLoopEnabled(enabled: boolean): void {
    this._loopEnabled = enabled;
    if (enabled && this._loopA !== null && this._loopB !== null && this.clock.playing) {
      this.startLoopScheduler();
    } else if (!enabled) {
      this.stopLoopScheduler();
    }
    this.notify();
  }

  clearLoop(): void {
    this._loopA = null;
    this._loopB = null;
    this._loopEnabled = true;
    this.stopLoopScheduler();
    this.notify();
  }

  private startLoopScheduler(): void {
    this.stopLoopScheduler();
    this.loopCheckInterval = setInterval(() => {
      if (this._loopEnabled && this._loopA !== null && this._loopB !== null && this.clock.playing && this.clock.currentTime >= this._loopB) {
        this.seek(this._loopA);
      }
    }, 10);
  }

  private stopLoopScheduler(): void {
    if (this.loopCheckInterval !== null) {
      clearInterval(this.loopCheckInterval);
      this.loopCheckInterval = null;
    }
  }

  dispose(): void {
    this.stopLoopScheduler();
    this.stop();
    this.disposeStemPlayers();
    this.ctx.close();
  }
}
