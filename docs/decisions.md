# Design Decisions

1. **Marker editor is a dev/admin tool** — Separate prep step, not end-user facing. Uses a Vite dev server endpoint to write config.json back to disk. No production backend needed.

2. **Beat-based marker positioning** — Markers stored as beat numbers (not seconds) in config.json. Beat grid overlay on the waveform is the primary positioning reference.

3. **beatOffset field** — Added to song config to handle audio where beat 1 doesn't start at 0:00. Set via a "Tap Beat 1" feature in the marker editor.

4. **Snap to beat boundaries** — Marker placement snaps to nearest integer beat. Fractional beats deferred to TODO.

5. **Freeform marker names + color picker** — No preset section names. Native HTML color input for simplicity.

6. **Modal with inline editing** — Marker editor opens as a modal overlay with direct manipulation on the timeline canvas (click to add, drag to reposition, click to edit).

7. **Two marker placement methods** — Click on timeline (snaps to nearest beat) or press M hotkey while playing (captures current position, snaps to beat).

8. **Variable tempo support** — Beat grid rendering handles multiple tempo map entries. Beats are not evenly spaced in time when BPM changes.
