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
