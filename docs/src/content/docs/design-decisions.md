---
title: "Design Decisions Behind Practice Portal"
description: "Key architectural and UX decisions that shaped the Practice Portal — from the TapMap timing model to keyboard-driven workflows and Transcribe! integration."
pubDate: "Apr 10 2026"
tags: ["architecture", "design", "tapmap"]
---

# Design Decisions

1. **Marker editor is a dev/admin tool** — Separate prep step, not end-user facing. Uses a Vite dev server endpoint to write config.json back to disk. No production backend needed.

2. **Beat-based marker positioning (tempoMap mode)** — For click-tracked recordings, markers stored as beat numbers in config.json with a computed beat grid from `tempoMap`.

3. **beatOffset field (tempoMap mode)** — Added to song config to handle audio where beat 1 doesn't start at 0:00. Set via a "Tap Beat 1" feature.

4. **TapMap as default timing model** — Instead of assuming constant BPM, the default is manually tapped beats. The admin plays the song and taps S/M/B keys to mark sections, measures, and beats. This supports rubato recordings naturally.

5. **Unified tapMap list** — All tapped events (sections, measures, beats) stored in a single time-sorted array with a `type` discriminator. Section > measure > beat hierarchy — a section implicitly is a measure start and a beat. Avoids merge complexity and duplication of separate lists.

6. **Dual timing modes** — Songs support both `tapMap` (tapped beats) and `tempoMap` (constant BPM grid). Presence of `tapMap` in config infers tapMap mode. No explicit mode field needed.

7. **TapMap Editor branding** — The admin tool is called "TapMap Editor" (not "Marker Editor"). Inspired by Transcribe! by Seventh String Software.

8. **Full-page editor with 30s default view** — Editor takes full screen. Scroll/shift+scroll navigates horizontally, Cmd/Ctrl+scroll zooms (5s to full song). Cursor-anchored zoom.

9. **Keyboard tapping workflow** — S key = section, M key = measure, B key = beat, Z key = undo. Only active when tap mode is enabled and audio is playing.

10. **Section auto-labeling** — Sections automatically named A, B, C... on tap. Renameable afterward in the section list.

11. **Transcribe! .xsc import** — Parser for Seventh String's Transcribe! file format to bootstrap tapMap data from existing beat-mapped files.

12. **Freeform section names** — No preset section names. Sections can be renamed to meaningful labels (Intro, Head, Solo, etc.) after tapping.

13. **Chord symbols: scope** — Chords are a separate `song.chords` document next to lyrics, editable by Owners, Managers and Editors. Shown by name only: no transpose, capo, simplify, diagrams, key changes or Nashville/Roman numbers for now. The chord track is independent of the score's chord symbols. See [Synced Chord Symbols](/docs/chord-symbols-research/).

14. **Chord symbols: now / next display** — A scrolling strip (placed as a lane, see 16): the current chord in a fixed slot, upcoming chords scrolling in from the right at a constant speed, spaced by time. No countdown: the gap to the next chord already shows how long is left.

15. **Chord symbols: stored as seconds** — Chords store only `symbol` and `time`, like lyrics; bar and beat are derived from the current tapMap when drawing. Chords are positioned on the beat grid while typing (`<` pushes to the "and"), and a "Snap to grid" button (half beats) tidies chords after a tapMap edit. Free time (no tapMap) never snaps. Chosen because chords mostly go in after the tapMap, an automatic tapMap may regenerate it later, many songs have pushes, and some passages have no bars at all.

16. **Chord symbols: first version focus** — Input is typing on the beat grid (Space next beat, Tab next bar, `<` for pushes), with tap to stamp as a second mode for free time and songs without a tapMap. Display is the scrolling now / next as a lane under the waveform, below notes and above lyrics. On desktop the current chord starts on the lyric reading point (`FOCUS_LEFT_NUDGE_PX`), lined up with the current lyric, and the next chord pushes it off to the left as it arrives. Imports, detection and the other chord views are later.
