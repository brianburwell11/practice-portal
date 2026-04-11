---
title: "Playing 25 Stems at Once: Mobile Audio Playback for a Practice Tool"
description: "Research into synced multi-stem audio playback on mobile browsers — memory math, format choices, time-stretching tradeoffs, and what actually works with the Web Audio API on phones."
pubDate: "Apr 09 2026"
tags: ["audio", "mobile", "web-audio-api", "performance", "research"]
---

Practice Portal is a web-based music practice tool where musicians load songs split into individual stems — drums, bass, guitar, vocals, keys, and more — then mix, mute, and slow them down to learn parts. On desktop, this works well. But we want it to work on a phone sitting on a music stand, and that changes everything. A typical song in our system might have 10 to 25 stems, each 3 to 6 minutes long, all playing in perfect sync while the user scrubs the tempo down to half speed. This post documents what we've learned about making that feasible on mobile.

## The Challenge

Playing 25 synchronized audio streams on a phone sounds straightforward until you do the math. The Web Audio API decodes compressed audio into raw PCM — 32-bit floating-point samples, one per channel per sample. For a single stereo stem at 44.1 kHz, that's:

$$2 \times 44{,}100 \times 4 = 352{,}800 \text{ bytes/sec} \approx 21.2 \text{ MB/min}$$

A 4-minute song with 25 stereo stems means:

$$25 \times 4 \times 21.2 = 2{,}120 \text{ MB}$$

Over 2 GB of decoded audio sitting in memory. A modern iPhone has 6-8 GB total RAM shared across the entire OS, and Safari's per-tab limit is considerably less — typically around 1-1.5 GB before the tab crashes. An entry-level Android phone might have 4 GB total. We're already over budget, and we haven't even started playing yet.

On top of the memory problem, there's the CPU cost of time-stretching 25 streams in real time without changing pitch, and the browser-specific quirks that make mobile audio uniquely frustrating.

## How We Currently Handle Audio

Before diving into the research, here's what Practice Portal already does. The `AudioEngine` creates a single `AudioContext` and decodes every stem into an `AudioBuffer` at load time. Each stem gets its own `StemPlayer` with this signal chain:

```
AudioBufferSourceNode
  → SoundTouch AudioWorklet (pitch-corrected time-stretch)
  → monoMixer (stereo/mono control)
  → GainNode (per-stem volume)
  → StereoPannerNode (pan)
  → masterGain
  → ctx.destination
```

Time-stretching uses the `@soundtouchjs/audio-worklet` package, which runs a port of the SoundTouch C++ library inside an `AudioWorkletProcessor`. The source's `playbackRate` speeds up or slows down playback, and SoundTouch compensates the pitch so the song doesn't sound like chipmunks at 1.5x or a slowed-down record at 0.5x.

This works well on desktop. On mobile, it hits walls.

## Memory: The First Wall

### The math that matters

Every `AudioBuffer` holds uncompressed PCM regardless of what format the original file was in. Once `decodeAudioData()` runs, an MP3 and a WAV of the same recording occupy identical memory. The only variables are duration, sample rate, and channel count:

| Stems | Channels | Duration | Memory |
|-------|----------|----------|--------|
| 10 | mono | 4 min | 423 MB |
| 10 | stereo | 4 min | 847 MB |
| 25 | mono | 4 min | 1,058 MB |
| 25 | stereo | 4 min | 2,117 MB |
| 25 | mono | 6 min | 1,588 MB |

The key insight: channel count is the single biggest lever. A mono stem uses exactly half the memory of a stereo one. For most instruments in a practice context — bass, kick drum, rhythm guitar, individual brass parts — mono is perfectly fine. You don't need stereo imaging on an isolated bass track when you're learning the notes. Stereo matters for things like drum overheads, piano, or ambient pads where the spatial information is part of the sound.

Practice Portal already supports per-stem mono/stereo toggling. The `StemPlayer` sets `monoMixer.channelCount = 1` by default and only switches to 2 when the user explicitly enables stereo on a stem. If we're disciplined about defaulting stems to mono and only keeping a few in stereo, 25 stems at 4 minutes drops from 2.1 GB to roughly 1.1 GB — still tight, but within reach.

### Strategies to reduce memory further

**Lower sample rate.** The Web Audio API's `AudioContext` has a fixed sample rate (usually 44,100 or 48,000 Hz). But you can create an `OfflineAudioContext` at a lower rate — say 22,050 Hz — decode the audio there, then resample up when connecting to the main context. This halves memory at the cost of losing frequencies above ~11 kHz. For practice purposes (learning notes and rhythm, not critical listening), this is an acceptable tradeoff, especially on phone speakers that can't reproduce those frequencies anyway.

**Chunked decoding.** Instead of decoding an entire 4-minute stem upfront, you could decode only the section the user is currently working on — say a 30-second window around the playhead. This requires fetching audio as `ArrayBuffer` chunks and stitching them with careful crossfades, which adds complexity but would keep memory proportional to the visible window rather than the full song.

**MediaElementAudioSourceNode.** An alternative to `AudioBufferSourceNode` is routing an `<audio>` element through the Web Audio API via `createMediaElementSource()`. The browser handles streaming and buffering, and you never hold the full decoded PCM in memory. The catch: you lose sample-accurate scheduling. Starting 25 `<audio>` elements simultaneously and keeping them in sync is unreliable — each element buffers independently, and there's no shared clock. For a mixer that needs frame-level sync, this is a dealbreaker unless you're willing to accept occasional drift.

## Audio Format: What to Store

Since decoded memory is format-independent, the choice of source format is about three things: file size (download speed), browser compatibility, and quality under time-stretching.

### Format comparison

| Format | Type | Size (4 min stereo) | iOS Safari | Android Chrome | Time-stretch quality |
|--------|------|---------------------|------------|----------------|---------------------|
| WAV 16-bit | Lossless | ~40 MB | Yes | Yes | Excellent (no artifacts to amplify) |
| FLAC | Lossless | ~20-25 MB | Yes | Yes | Excellent |
| AAC (M4A) 256k | Lossy | ~8 MB | Yes | Yes | Good |
| OGG Vorbis 192k | Lossy | ~6 MB | Yes (18.4+) | Yes | Good |
| Opus 128k | Lossy | ~4 MB | Yes (18.4+) | Yes | Very good (best lossy quality per bit) |
| MP3 192k | Lossy | ~6 MB | Yes | Yes | Fair (encoder artifacts amplified) |

### Why format matters for slow playback

When you time-stretch audio, you're expanding small moments of sound into longer ones. Any compression artifacts in the source — the slight warbling of MP3, the pre-echo of low-bitrate AAC — get stretched too, making them more audible. It's like zooming into a JPEG: the blocks that were invisible at normal size become obvious.

Lossless formats (WAV, FLAC) have no artifacts to reveal, so they sound best under time-stretching at any ratio. Among lossy formats, Opus handles this best because its codec design produces fewer of the "smearing" artifacts that become audible when stretched. AAC at higher bitrates (256 kbps+) is also fine for practice purposes.

MP3 is the worst choice specifically for time-stretching. The MP3 codec's reliance on the modified discrete cosine transform produces characteristic pre-echo artifacts around transients (drum hits, note attacks) that become a metallic "swooshing" sound when the audio is slowed significantly below 0.7x.

### Our recommendation

**FLAC for storage, with Opus as a fallback.** FLAC gives lossless quality at roughly half the size of WAV. For a 25-stem, 4-minute song:

- WAV: ~1,000 MB total download (prohibitive on mobile data)
- FLAC: ~500-600 MB (still large, but cacheable)
- Opus 128k: ~100 MB (very manageable)

The practical approach is to store FLAC as the archival format and serve Opus to mobile clients where bandwidth is constrained. Safari's Opus support (in MP4 or WebM containers) has been reliable since iOS 18.4, which covers the vast majority of active iPhones as of 2026. For the rare older device, fall back to AAC.

## Time-Stretching: The CPU Challenge

Slowing audio down without changing pitch requires a time-stretching algorithm. There are three main families, each with different quality and cost tradeoffs.

### The algorithms

**WSOLA (Waveform Similarity Overlap-Add)** works in the time domain. It finds similar waveform segments using cross-correlation and overlaps them to stretch or compress time. It's fast and works well on monophonic signals — a single voice, a solo instrument. On polyphonic material (a full drum kit, a chord), it produces "stuttering" and "transient doubling" artifacts because it can't find clean overlap points in complex waveforms.

**Phase Vocoder** works in the frequency domain via the Short-Time Fourier Transform. It decomposes audio into frequency bins, adjusts the phase relationships, and resynthesizes. It handles polyphonic material much better than WSOLA but introduces "phasiness" — a subtle reverb-like coloring that makes audio sound like it's in a tunnel. It also smears transients: a crisp snare hit becomes a softer "pshh."

**Hybrid approaches** (like Rubber Band and the newer SoundTouch algorithms) combine both: they use phase vocoder for tonal content and time-domain techniques for transients, detecting drum hits and passing them through with minimal processing. This gives the best of both worlds at higher CPU cost.

### What runs in a browser

| Library | Algorithm | Runs in AudioWorklet | WASM | Quality | CPU cost |
|---------|-----------|---------------------|------|---------|----------|
| SoundTouchJS | WSOLA + overlap-add | Yes | No (pure JS) | Good | Low |
| Rubber Band (WASM) | Hybrid (phase vocoder + transient detection) | Experimental | Yes | Excellent | High |
| Superpowered | Proprietary | Yes | Yes | Excellent | Medium |
| Native `playbackRate` | Resampling (no pitch correction) | Built-in | N/A | N/A (pitch shifts) | Minimal |

**SoundTouchJS** is what Practice Portal uses today. It runs as an `AudioWorkletProcessor`, processing 128-sample blocks on the audio thread. For a single stem, CPU usage is negligible. But 25 stems each running their own SoundTouch instance means 25 instances of the algorithm running per audio quantum (roughly every 2.9 ms at 44.1 kHz). On a phone's efficiency cores, this adds up.

**Rubber Band via WASM** produces significantly better results — cleaner transients, less phasiness — but the WASM module is larger (~300 KB) and each instance uses more CPU. Running 25 Rubber Band instances in real-time on mobile is currently impractical.

**The `playbackRate` property** on `AudioBufferSourceNode` is nearly free — it's handled by the browser's native resampler. The tradeoff is that it changes pitch proportionally. At 0.5x speed, everything sounds an octave lower. For some practice scenarios this is actually fine: if you're learning rhythm patterns and don't care about pitch, native `playbackRate` is the cheapest option by far.

### A practical hybrid approach

Instead of running 25 SoundTouch instances, consider this architecture:

1. **Set `playbackRate` on all 25 source nodes** — this is essentially free
2. **Run SoundTouch on a single summed bus** — mix all stems down to a stereo pair first, then pitch-correct the mix

This means the per-stem solo/mute/volume controls still work (they're upstream of the mix bus), but you only pay the CPU cost of one time-stretcher instead of 25. The downside: if you change the mix (mute a stem, adjust volume), there's no "pre-stretched" individual stem to work with — the pitch correction happens after mixing. In practice, this sounds identical to per-stem stretching because pitch correction is a linear operation on the summed signal.

```javascript
// Conceptual architecture
stems.forEach(stem => {
  stem.source.playbackRate.value = tempoRatio; // free
  stem.source → stem.gain → stem.pan → mixBus;  // per-stem controls
});

// Single time-stretcher on the mix bus
mixBus → soundTouchNode → masterGain → destination;
```

This reduces CPU cost from O(n) to O(1) for the expensive operation.

## Mobile Browser Quirks

### iOS Safari

- **AudioContext requires user gesture.** The context starts in a `suspended` state and must be resumed inside a `touchend` or `click` handler. Practice Portal handles this by calling `ctx.resume()` on the first play button tap.

- **4 AudioContext limit.** Safari allows a maximum of 4 AudioContext instances per page. This isn't a problem if you reuse a single context (which you should), but it's a trap if you create contexts per stem.

- **No background audio.** When the user switches tabs or locks the screen, Safari suspends the AudioContext. The audio stops. There's no reliable workaround in a web app — this is an OS-level restriction. For a practice tool where the phone is on a music stand with the screen on, this is acceptable. For background listening, it's not.

- **Sample rate is device-dependent.** iOS typically creates contexts at 48,000 Hz, not 44,100 Hz. If your stems are 44.1 kHz, the browser resamples during decode, which slightly increases memory usage (~8.8% more samples per second).

### Android Chrome

- **Generally more permissive.** AudioContext restrictions exist but are less aggressive than Safari. Background audio works in some cases.

- **Autoplay policy.** Similar user-gesture requirement, but Chrome is more lenient about what counts as a gesture.

- **Device fragmentation.** The range of Android hardware is enormous. A flagship Samsung has 12 GB RAM and desktop-class CPU cores. A budget phone has 3-4 GB RAM and efficiency-only cores. You need to handle both gracefully — detect available memory and degrade (fewer stems, lower sample rate) on constrained devices.

### AudioWorklet support

`AudioWorklet` is supported on all modern mobile browsers (Safari 14.5+, Chrome for Android 66+). This is critical because the alternative — `ScriptProcessorNode` — runs on the main thread and causes audio glitches when the UI is busy (scrolling, rendering). SoundTouch's AudioWorklet implementation avoids this by running entirely on the audio rendering thread.

## Sync: Keeping 25 Stems Together

The single most important requirement is that all stems play in perfect sync. A 5 ms drift between the bass and drums is audible and maddening.

### Why AudioBufferSourceNode sync works

When you call `source.start(when)` on multiple `AudioBufferSourceNode` instances with the same `when` parameter (a time on the `AudioContext.currentTime` clock), the browser's audio graph renders them in the same processing quantum. They're mixed sample-by-sample in the same callback. There's no network jitter, no buffering variance, no independent clocks. This is the fundamental advantage of `AudioBufferSourceNode` over `<audio>` elements or `MediaElementSourceNode`.

Practice Portal's `AudioEngine.play()` method starts all stems with the same context-time offset:

```javascript
// From AudioEngine.ts — simplified
const startTime = this.ctx.currentTime;
const offset = this.clock.position; // where in the song to resume

this.stemPlayers.forEach(player => {
  player.start(startTime, offset);
});
```

Because all players reference the same `AudioContext` clock and start at the same quantum boundary, sync is sample-accurate. This holds even at modified tempos — all sources share the same `playbackRate` value set synchronously.

### Where sync breaks down

- **MediaElementSourceNode**: Each `<audio>` element has its own buffering and decoding pipeline. Starting 25 of them "simultaneously" with `element.play()` introduces variable startup latency. Elements might be 10-50 ms apart. Unacceptable.

- **Multiple AudioContexts**: Each context has its own clock. Cross-context sync requires manual correction and is never sample-accurate.

- **Drift over time**: If stems have different sample rates or were encoded with slightly different durations, they'll drift over a long song. Ensure all stems come from the same source session and are trimmed to identical lengths.

## Practical Recommendations

Based on this research, here's what we'd recommend for Practice Portal's mobile strategy:

### Tier 1: Works now (10-15 stems)

- Keep the current `AudioBufferSourceNode` + SoundTouch architecture
- Default all stems to mono (halves memory)
- Serve Opus-encoded files to mobile (smaller downloads, fast decode)
- Target 10-15 stems on mobile, with graceful degradation for larger track counts

### Tier 2: Near-term improvements (15-20 stems)

- Implement the single-bus SoundTouch architecture (1 time-stretcher instead of N)
- Downsample to 22,050 Hz on mobile (halves memory again)
- Lazy-decode: only decode stems the user has un-muted
- With mono stems at 22 kHz, 20 stems at 4 min = ~265 MB. Very manageable.

### Tier 3: Future exploration (25+ stems)

- Chunked streaming with `AudioWorklet`-based decoding
- Pre-mix less important stems server-side (combine 5 backing vocal stems into one stereo submix)
- Explore `OfflineAudioContext` for pre-rendering the time-stretched audio when the user sets a tempo, rather than stretching in real-time

### Memory budget summary

| Strategy | 25 stems, 4 min | Feasible on mobile? |
|----------|-----------------|---------------------|
| Stereo, 44.1 kHz | 2,117 MB | No |
| Mono, 44.1 kHz | 1,058 MB | Tight (flagship only) |
| Mono, 22.05 kHz | 529 MB | Yes |
| Mono, 22.05 kHz + lazy decode | ~200-300 MB | Comfortable |

## What's Next

The immediate next step for Practice Portal is implementing mono-by-default stems and Opus encoding in the asset pipeline. These two changes alone cut memory usage by 50% and download size by 80% — the biggest bang for the least effort. After that, the single-bus SoundTouch optimization and sample rate reduction would unlock comfortable 20+ stem playback on most phones manufactured in the last three years.

The nuclear option — chunked streaming with AudioWorklet decoding — is worth prototyping but represents a significant architecture change. We'd reach for it only if real-world usage shows that 20+ stem songs are common enough to justify the complexity.

---

*Relevant source files: `src/audio/AudioEngine.ts`, `src/audio/StemPlayer.ts`, `src/audio/TransportClock.ts`, `src/store/mixerStore.ts`*
