---
title: "Bluetooth Headphone Latency"
description: "Shift lyrics, chords, the beat counter and editor stamps by the headphones' output delay, so what you see matches what you hear."
pubDate: "Nov 16 2026"
tags: ["audio", "latency", "bluetooth", "plan"]
---

**Goal:** with Bluetooth headphones, sound reaches the ear 150 to 250 ms after the audio clock says it played. Visuals and editor stamps should follow what you hear, not what was sent. Measure the delay by tapping along with a steady click, which relies on rhythm rather than reaction time.

## How it works

`TransportClock` has two readings:

| Reading | Meaning | Used by |
|---|---|---|
| `currentTime` | Where the audio is being scheduled | Playback, seek, pause, loops, tempo, lock screen |
| `audibleTime` | `currentTime` minus the output latency | Store `position` (every visual), editor stamping and tapping, YouTube sync |

The latency is `ctx.outputLatency + ctx.baseLatency` (the browser's report, read live so it follows headphones connecting and disconnecting) plus a per-device adjustment in `localStorage` (`practice-portal.outputLatencyAdjustMs`).

After play or seek, `audibleTime` holds at the start point until the first sound reaches the ear. After a tempo or loop rebase it carries on smoothly, because earlier audio is still in the pipe.

## Phase 1: auto-detect plus manual adjustment

- [x] `TransportClock.audibleTime`, with tests (`src/audio/TransportClock.test.ts`)
- [x] `AudioEngine.detectedLatencySeconds`, `outputLatencySeconds`, `setLatencyAdjustMs`
- [x] `src/store/latencyStore.ts`, per device
- [x] Store `position` follows `audibleTime`
- [x] Lyrics timing, chord stamping, tapMap marker keys and pads stamp `audibleTime`
- [x] YouTube sync and its calibration use `audibleTime`
- [x] "Calibrate Audio Latency" button in the TapMap editor (in More on phones): detected, adjustment slider, total
- [ ] Check on AirPods: beat counter and chord changes line up with the click stem by ear
- [ ] Check pause, seek, A/B loop and tempo change on Bluetooth
- [ ] Stamp a lyric on Bluetooth, replay on speakers: timing is right, not early

## Phase 2: tap-along calibration

Like lag calibration in a rhythm game. The dialog shows the detected delay as a first guess. Start plays a click at 130 BPM through the song's own path (SoundTouch, master gain, the iOS `<audio>` element), so it picks up the same delay the song does. Tap along by ear, on the pad or with Space.

Each tap is compared to the click grid (`src/audio/latencyCalibration.ts`). The first 4 taps are warm-up. The estimate is the mean of the last 8 taps after dropping strays. The run ends after 30 seconds, or early once 12 taps are in and the window's spread is under 12 ms. Save stores measured minus detected as the adjustment, and the slider stays for fine tuning.

The measurement includes the tap's own input delay. That is wanted: stamping uses the same taps, so the correction covers both.

- [x] `AudioEngine.scheduleClick`, `beginCalibration`, `endCalibration`
- [x] Offset and rolling estimate maths, with tests (`src/audio/latencyCalibration.test.ts`)
- [x] Dialog: detected guess, Start, tap pad, progress, result, Save or Try again, fine tune slider
- [ ] Laptop speakers: result is small (about 20 to 60 ms)
- [ ] AirPods: result lands near 150 to 250 ms, and the beat counter lines up by ear after Save
- [ ] Steady tapping ends the run early; sloppy tapping runs the full 30 seconds
- [ ] Stop, Escape and closing the dialog silence the click at once
- [ ] iOS: the click is audible (output opens inside the Start tap)

## Known limits

- Safari may report `outputLatency` as 0. The tap-along calibration then does all the work.
- On iOS, playback goes through an `<audio>` element for background play (`BackgroundAudio.ts`), which adds delay the context doesn't report.
- The SoundTouch pitch and tempo node adds a small fixed delay. The calibration click goes through it, so the measurement catches it.
