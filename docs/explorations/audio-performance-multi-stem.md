# Audio Performance: Reduce Choppy Playback with Multiple Stems

## Problem

Songs with 5-6+ stems produce choppy audio. The root cause: each stem runs its own SoundTouch AudioWorklet instance (heavy DSP: overlap-add time-stretching + pitch correction). All AudioWorklets execute **sequentially on a single audio thread**, so N stems = N× the DSP work per 128-sample block. Additionally, SoundTouchNodes are destroyed and recreated on every play/seek.

Current per-stem audio graph (6 nodes each):
```
AudioBufferSourceNode → SoundTouchNode → MonoMixer → GainNode → StereoPannerNode → MasterGain
```

With 6 stems: 36 AudioNodes, 6 parallel SoundTouch DSP instances.

## Research Findings

### Why it's slow
- All AudioWorklets share a single `AudioWorkletGlobalScope` and execute **sequentially on one audio thread**
- SoundTouch runs complex DSP per instance: RateTransposer (linear interpolation) + Stretch engine (overlap-add, correlation matching)
- SoundTouchNode is destroyed and recreated on every `start()` call (allocation overhead)
- Full AudioBuffers held in memory: 6 stems × 3 min × stereo × 32-bit float ≈ ~380MB

### Key insight
- At 1.0x tempo (the most common case), SoundTouch is doing expensive no-op processing
- A single SoundTouch instance on the mixed output produces the same result as N instances on individual stems, at 1/N the cost

### iOS Safari specifics
- No `detune` property — only `playbackRate` available
- Documented WebKit bugs with Web Audio processing delays (bug 221334)
- AudioContext must be resumed via user gesture

## Plan

### Phase 1: Bypass SoundTouch at 1.0x (quick win)

When `tempoRatio === 1.0`, connect source → monoMixer directly, skipping SoundTouchNode entirely. Also stop recreating SoundTouchNode on every `start()`.

**Files**: `src/audio/StemPlayer.ts`

### Phase 2: Single Shared SoundTouch (biggest payoff)

Consolidate all SoundTouch processing into one instance on the mixed output.

New audio graph:
```
Per stem (4 nodes each, down from 6):
  AudioBufferSourceNode → MonoMixer → GainNode → StereoPannerNode
                                                        ↓
                                              SharedMixBus (GainNode)
                                                        ↓
                                              Single SoundTouchNode
                                                        ↓
                                                    MasterGain → Destination
```

- Sources still play at `tempoRatio` speed (feeding samples faster/slower)
- Individual vol/pan/mute/solo applied per-stem BEFORE the mix bus
- One SoundTouch corrects pitch on the combined output
- At 1.0x tempo: bypass SoundTouch entirely (mixBus → masterGain)

**Files**: `src/audio/AudioEngine.ts`, `src/audio/StemPlayer.ts`

### Future considerations (not planned yet)
- **Chunked/streaming decode**: Decode 10-30 second chunks on demand instead of full songs upfront. Reduces memory from ~380MB to ~60MB. More complex synchronization.
- **Pre-mixed server-side stems**: Group stems into fewer mixes server-side for devices that can't handle many tracks.

## Sources
- [Web Audio API performance notes](https://padenot.github.io/web-audio-perf/)
- [AudioWorklet performance pitfall](https://cprimozic.net/blog/webaudio-audioworklet-optimization/) — 50%+ gain from reducing per-instance parameters
- [Audio worklet design patterns](https://developer.chrome.com/blog/audio-worklet-design-pattern)
- [WebKit Bug 221334](https://bugs.webkit.org/show_bug.cgi?id=221334) — Safari audio delays
- [MDN: Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
