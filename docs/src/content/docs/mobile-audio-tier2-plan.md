---
title: "Tier 2 Mobile Audio: Implementation Plan"
description: "Step-by-step plan for single-bus SoundTouch, mobile downsampling, and lazy decode — the next round of mobile audio optimizations."
pubDate: "Apr 11 2026"
tags: ["audio", "mobile", "implementation", "plan"]
---

This plan implements the **Tier 2** improvements from the [mobile audio playback research](/docs/mobile-audio-playback/#tier-2-near-term-improvements-15-20-stems). The goal is comfortable 15-20 stem playback on mobile. Each phase is an independent commit, testable in isolation.

## Phase 1: Single-bus SoundTouch

Move from N per-stem SoundTouch instances to a single shared instance on the mix bus. CPU cost for pitch correction drops from O(n) to O(1).

**Signal chain change:**
```
BEFORE:  source → SoundTouch → monoMixer → gain → pan → masterGain → dest
                                                          (N instances)

AFTER:   source → monoMixer → gain → pan → mixBus → SoundTouch → masterGain → dest
         (playbackRate on source)                      (1 instance)
```

- [ ] Remove SoundTouchNode from `StemPlayer` — simplify chain to `source → monoMixer → gain → pan → destination`
- [ ] Add `mixBus` GainNode and shared `SoundTouchNode` to `AudioEngine`
- [ ] Wire chain: `mixBus → soundTouchNode → masterGain → ctx.destination`
- [ ] Pass `mixBus` (not `masterGain`) as destination when constructing StemPlayers
- [ ] Update `setTempo()` to set `playbackRate` on the shared SoundTouchNode once + native `playbackRate` on each source
- [ ] Recreate shared SoundTouchNode on `play()`/`seek()` to flush internal buffers

**Test:**
- [ ] Play at 1x — sounds identical to before
- [ ] Slow to 0.5x — pitch stays corrected (not detuned)
- [ ] Mute/solo/volume/pan per stem — still works
- [ ] A/B loop and seek while playing — no glitches

---

## Phase 2: Mobile downsample to 22,050 Hz

Decode audio at half sample rate on mobile, cutting decoded PCM memory ~50%. Frequencies above ~11 kHz are lost — inaudible on phone speakers.

- [ ] Add mobile detection helper to `AudioEngine` (`navigator.maxTouchPoints > 0` or similar)
- [ ] Extract `decodeAudio(arrayBuffer)` helper — desktop uses `ctx.decodeAudioData()`, mobile uses `OfflineAudioContext` at 22,050 Hz
- [ ] Replace `decodeAudioData` call in `loadSong()` with new helper

**Test:**
- [ ] Desktop: unchanged behavior (44.1/48 kHz decode)
- [ ] Mobile (or forced flag): stems decode at 22,050 Hz
- [ ] Playback, tempo, mute/solo all still work at lower sample rate

---

## Phase 3: Lazy decode

Skip decoding muted stems at load time. Decode on-demand when the user unmutes.

- [ ] Add `pendingStems` map to `AudioEngine` — stores `{ config, arrayBuffer }` for undecoded stems
- [ ] In `loadSong()`: only decode stems with `defaultVolume > 0`; stash the rest in `pendingStems`
- [ ] Add `decodeStem(id)` method — decode pending buffer, create StemPlayer, connect to mixBus, start if currently playing
- [ ] Hook `setStemMuted(id, false)` to trigger `decodeStem()` for pending stems
- [ ] Handle peak computation with partial stem data (only decoded stems contribute)

**Test:**
- [ ] Load a song with some stems at volume 0 — those should not decode
- [ ] Unmute a pending stem — it decodes and joins playback seamlessly
- [ ] Memory at load time is proportional to audible stems, not total stems

---

## Memory budget after all three phases

| Strategy | 25 stems × 4 min | Feasible? |
|----------|-------------------|-----------|
| Before (stereo, 44.1 kHz, N SoundTouch) | 2,117 MB | No |
| After Tier 1 (mono, 44.1 kHz) | 1,058 MB | Tight |
| + Phase 2 (mono, 22.05 kHz) | 529 MB | Yes |
| + Phase 3 (lazy, ~10 active) | ~200 MB | Comfortable |

---

*Files: `src/audio/AudioEngine.ts`, `src/audio/StemPlayer.ts`*
