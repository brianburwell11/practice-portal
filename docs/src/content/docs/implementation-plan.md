---
title: "Practice Portal Implementation Plan"
description: "The full technical blueprint — tech stack, audio engine architecture, song config schema, state management, and phased implementation roadmap."
pubDate: "Apr 10 2026"
tags: ["architecture", "planning", "web-audio-api", "react"]
---

# Practice Portal — Implementation Plan

## Context

Building a fully static, client-side web app for musicians to practice along with multi-stem recordings. The app plays synchronized audio stems with a mixer, programmable metronome, A/B looping, tempo adjustment, and timeline markers. Deployed to GitHub Pages or CloudFront — no backend.

## Tech Stack

- **Vite + React + TypeScript**
- **Web Audio API** for all audio processing
- **@soundtouchjs/audio-worklet** for time-stretching with pitch correction (25%-200%)
- **Zustand** for state management
- **Zod** for runtime validation of song config JSON
- **Tailwind CSS** for styling
- **@radix-ui/react-slider** for accessible slider controls

## Song Configuration (JSON per song)

Each song lives in `public/audio/{band-id}/song-{id}/` with a `config.json`:

```jsonc
{
  "id": "blue-bossa",
  "title": "Blue Bossa",
  "artist": "Kenny Dorham",
  "key": "Cm",
  "durationSeconds": 245.5,
  "stems": [
    { "id": "drums", "label": "Drums", "file": "drums.mp3", "defaultVolume": 0.8, "defaultPan": 0.0, "color": "#e74c3c" }
  ],
  "groups": [
    { "id": "drums", "label": "Drums", "color": "#ef4444", "stemIds": ["kick", "snare", "hi-tom", "lo-tom", "ovhd"] }
  ],
  "tempoMap": [{ "beat": 0, "bpm": 160 }],
  "timeSignatureMap": [{ "beat": 0, "numerator": 4, "denominator": 4 }],
  "metronome": {
    "clickSound": "woodblock",
    "accentPattern": [1.0, 0.4, 0.6, 0.4],
    "subdivisions": 1
  },
  "markers": [
    { "name": "Intro", "beat": 0, "color": "#2ecc71" },
    { "name": "Head A", "beat": 16, "color": "#9b59b6" }
  ]
}
```

A top-level `public/audio/manifest.json` indexes all songs (id, title, artist, path) so the song list renders without loading every config.

## Audio Engine Architecture

### Core Principle
All timing authority lives on `AudioContext.currentTime`, never on `setTimeout`/`setInterval`.

### TransportClock (single source of truth for position)
- Tracks `contextTimeAtPlay`, `songTimeAtPlay`, and `tempoRatio`
- Current position: `songTimeAtPlay + (ctx.currentTime - contextTimeAtPlay) * tempoRatio`
- On tempo change: captures current position, resets anchor times, updates ratio
- Manages A/B loop detection — when position reaches B, resets all stems to A

### StemPlayer (one per stem)
Audio chain:
```
AudioBufferSourceNode → SoundTouchNode (AudioWorklet) → GainNode → StereoPannerNode → masterGain → destination
```
- All stems started with the same `when` and `offset` params for sample-accurate sync
- Solo/mute handled at GainNode level (gain = 0 for muted/non-soloed)
- Group volume acts as a multiplier on child stem gains

### Stem Grouping
- Songs can define optional `groups` that reference stem IDs
- Group-level volume, mute, and solo controls
- Group mute silences all children regardless of individual state
- Group solo participates in solo logic alongside individual stem solos
- UI: collapsible group strips with expandable child stems

### MetronomeScheduler
- Look-ahead scheduling pattern (~25ms interval, ~100ms look-ahead window)
- Computes beat positions from the song's tempo map and time signature map
- Schedules `OscillatorNode` bursts (or click sample buffers) at precise `AudioContext.currentTime`
- Accent patterns: array of relative volumes per beat in a measure
- Scales beat times by `tempoRatio` to stay synced with adjusted playback

### AudioEngine (orchestrator class)
```typescript
class AudioEngine {
  async loadSong(config: SongConfig): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setTempo(ratio: number): void;
  setABLoop(a: number | null, b: number | null): void;
  setGroupVolume(groupId: string, v: number): void;
  setGroupMuted(groupId: string, muted: boolean): void;
  setGroupSoloed(groupId: string, soloed: boolean): void;
}
```
Plain TypeScript class (not a React component). Provided to React via context. Pushes state updates into Zustand stores.

## Project Structure

```
practice-portal/
├── public/audio/                    # Static audio assets (not processed by Vite)
│   ├── manifest.json
│   └── {band-id}/song-{id}/config.json + stems
├── src/
│   ├── audio/                       # Audio engine (plain TS, no React)
│   │   ├── AudioEngine.ts
│   │   ├── TransportClock.ts
│   │   ├── StemPlayer.ts
│   │   └── MetronomeScheduler.ts
│   ├── config/schema.ts             # Zod schemas for song config
│   ├── hooks/                       # useAudioEngine, useTransport, useStemControls, useMetronome
│   ├── store/                       # Zustand: songStore, mixerStore, transportStore
│   ├── components/
│   │   ├── song-select/SongList.tsx
│   │   ├── transport/TransportBar.tsx, TempoControl.tsx
│   │   ├── mixer/MixerPanel.tsx, ChannelStrip.tsx, MasterStrip.tsx, GroupStrip.tsx
│   │   ├── timeline/Timeline.tsx, Marker.tsx, ABLoopOverlay.tsx
│   │   ├── metronome/MetronomeToggle.tsx, MetronomePatternEditor.tsx
│   │   └── waveform/WaveformDisplay.tsx
│   └── App.tsx
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

## State Flow

- `AudioEngine` is the authority — pushes state into Zustand stores
- React components subscribe to Zustand slices
- User interactions → engine methods → update Web Audio graph + Zustand stores
- `requestAnimationFrame` loop reads `TransportClock.currentPosition()` ~60fps for the timeline playhead (visual only, not for audio scheduling)

## Implementation Phases

### Phase 1: Scaffold + Basic Playback
- Init Vite + React + TS project with Tailwind, Zustand, Zod
- Implement `AudioEngine`, `TransportClock`, `StemPlayer` (no time-stretching yet)
- One test song with 2-3 stems in `public/audio/`
- `TransportBar` (play/pause/stop) + minimal `MixerPanel` (volume sliders)
- **Goal**: Stems play in perfect sync

### Phase 1.5: Stem Grouping
- Added `groups` to song config schema
- Group-level volume (multiplier), mute, solo controls
- Collapsible GroupStrip UI with nested ChannelStrips
- St. James song configured with "Drums" group

### Phase 2: Full Mixer + Timeline
- Add `StereoPannerNode`, pan controls, solo/mute, master volume
- Canvas-based `Timeline` with waveform overview (computed peaks)
- Section markers from config, click-to-seek

### Phase 3: Metronome
- `MetronomeScheduler` with look-ahead scheduling
- Parse tempo map + time signature map
- Click sounds (oscillator bursts or samples)
- Accent patterns, `MetronomeToggle` UI

### Phase 4: Tempo Adjustment (Pitch-Corrected)
- Integrate `@soundtouchjs/audio-worklet`
- Insert SoundTouch nodes into stem chains
- `TempoControl` slider (25%-200%)
- Update TransportClock + MetronomeScheduler for tempo ratio

### Phase 5: A/B Looping
- Draggable A/B markers on timeline
- Loop detection in transport — seek-to-A when position passes B
- Pre-schedule restart for gapless looping

### Phase 6: Song Browser + Lazy Loading
- `SongList` fetches manifest, shows all songs
- On select: fetch config → fetch+decode stems in parallel with progress indicator
- Cleanup previous song's resources

### Phase 7: Metronome Pattern Editor
- Visual grid editor for accent levels and subdivisions
- Real-time preview, save to localStorage

### Phase 8: Polish + Deploy
- Keyboard shortcuts (space=play/pause, etc.)
- localStorage persistence for mixer settings per song
- Responsive layout
- Deploy: `vite build` → GitHub Pages or S3+CloudFront

## Audio Asset Deployment Strategy

10+ songs x 4-8 stems x ~3-5 MB each = 200-500 MB total.

**Recommended**: S3 + CloudFront for audio, GitHub Pages for the app.
- App reads `VITE_AUDIO_BASE_URL` env var at build time
- Audio files in S3 with long `Cache-Control` max-age (immutable)
- CORS configured on CloudFront to allow GitHub Pages origin
- Alternative: single CloudFront distribution serving both app and audio

## Verification

- Phase 1: Play 2-3 stems simultaneously, confirm sync by ear and by checking `AudioBufferSourceNode.start()` params
- Phase 2: Solo one stem, verify others go silent. Pan a stem hard L/R.
- Phase 3: Enable metronome, verify click aligns with beat 1 of the track
- Phase 4: Slow to 50%, verify pitch stays correct and metronome stays locked
- Phase 5: Set A/B loop, verify seamless looping with no audible gap
- Phase 6: Switch songs, verify previous audio stops and new song loads correctly
- Phase 7: Edit metronome pattern, verify changes are audible immediately
- Phase 8: Deploy to GitHub Pages, load in browser, verify full functionality
