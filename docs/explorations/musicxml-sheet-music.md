# Exploration: MusicXML Sheet Music Rendering with Synchronized Playhead

**Date**: 2026-03-31
**Status**: Research complete, not yet implemented

## Goal

Render `.musicxml` files as proper sheet music notation that scrolls along with the audio playhead during playback. This would let musicians read along with their part while practicing.

## MusicXML Files in This Project

Two test files exist at `public/audio/song-test/`:
- `Wiggle-00SCORE.musicxml` — full ensemble score (multiple parts)
- `Wiggle-01Trumpet_1.musicxml` — individual Trumpet 1 part

### File Structure (Trumpet 1 example)
- **Format**: MusicXML 4.0 (partwise)
- **Created with**: MuseScore Studio 4.6.5
- **Song**: "Wiggle" by Ryan Gamberino / SOOZA Brass Band
- **Instrument**: Trumpet in B♭ (transposing, -2 chromatic semitones)
- **Key**: F Major (1 flat)
- **Time Signature**: 4/4
- **Tempo**: 132 BPM (quarter note)
- **Divisions**: 12 per quarter note (so eighth=6, 16th=3, dotted eighth=9, triplet eighth=4)
- **Features present**: staccato, tenuto, dotted notes, triplets, beams, rehearsal marks, rests

### MusicXML Timing Model
```
<divisions>12</divisions>  → 12 = one quarter note

Duration values:
  12 = quarter note
  6  = eighth note
  3  = sixteenth note
  9  = dotted eighth
  4  = triplet eighth (time-modification: 3 actual / 2 normal)

Each 4/4 measure = 48 divisions total
```

Measures are sequential `<measure>` elements containing `<note>` elements with `<pitch>`, `<duration>`, `<type>`, and optional `<articulations>`.

---

## Recommended Library: OpenSheetMusicDisplay (OSMD)

**Package**: `opensheetmusicdisplay` (npm)
**What it does**: Parses MusicXML and renders it as SVG via VexFlow
**Bundle size**: ~1-2MB (should be lazy-loaded)

### Key API
```ts
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const osmd = new OpenSheetMusicDisplay(containerElement, {
  autoResize: true,
  drawTitle: false,
  drawComposer: false,
  followCursor: true,         // auto-scrolls to keep cursor visible
  cursorsOptions: [{
    type: 0,                  // standard cursor
    color: '#3B82F6',         // blue, matching our waveform playhead
    alpha: 0.4,
    follow: true,
  }],
});

await osmd.load(xmlString);   // parse MusicXML
osmd.render();                 // draw to SVG in the container

osmd.cursor.show();            // display the cursor
osmd.cursor.next();            // advance to next beat position
osmd.cursor.reset();           // go back to the beginning
osmd.cursor.iterator;          // access current measure/beat position
```

---

## Synchronization Strategy

### The Chain: Audio Seconds → Score Position
```
transportStore.position (seconds)
        ↓
secondsToBeat(position, tempoMap, beatOffset)   ← existing utility in tempoUtils.ts
        ↓
absoluteBeat (float)
        ↓
binary search pre-built TimestampMap[]
        ↓
OSMD cursor index
        ↓
cursor.next() or cursor.reset() + iterate
```

### Building the Timestamp Map

After OSMD renders, iterate all cursor positions once and record:
```ts
interface ScoreTimestamp {
  cursorIndex: number;       // sequential index
  measureNumber: number;     // from MusicXML
  beatInMeasure: number;     // beat offset within measure (quarter notes)
  absoluteBeat: number;      // absolute beat from song start
}
```

Algorithm:
1. `cursor.reset()`, index = 0
2. At each position, read `cursor.iterator.currentMeasureIndex` and voice entry timestamp
3. Compute `absoluteBeat = measureIndex * beatsPerMeasure + beatWithinMeasure`
4. Store in sorted array
5. Repeat `cursor.next()` until end

Provide `findCursorIndexForBeat(beat: number, timestamps: ScoreTimestamp[]): number` via binary search.

### Cursor Update During Playback
- **Normal forward playback**: Just call `cursor.next()` — O(1), the common case
- **Seek/jump**: `cursor.reset()` then iterate to target index
- **Throttle**: ~15-20Hz (every ~50-66ms). Note changes at 132 BPM in 4/4 happen at most ~8-9 times/sec for eighth notes
- **OSMD's `followCursor: true`** handles auto-scrolling the container

---

## Data Model Changes Needed

### `src/audio/types.ts`
Add optional `scoreFile` to both `StemConfig` and `SongConfig`:
```ts
export interface StemConfig {
  // ...existing...
  scoreFile?: string;  // e.g. "Wiggle-01Trumpet_1.musicxml"
}

export interface SongConfig {
  // ...existing...
  scoreFile?: string;  // e.g. "Wiggle-00SCORE.musicxml" for full score
}
```

### `src/config/schema.ts`
Add `scoreFile: z.string().optional()` to both Zod schemas.

### `public/audio/song-test/config.json`
Add `"scoreFile"` fields to the song and relevant stems.

---

## New Files to Create

### `src/audio/scoreSync.ts`
Timestamp mapping utility. Builds the `ScoreTimestamp[]` array from an OSMD instance after render, and provides `findCursorIndexForBeat()`.

### `src/components/score/ScoreViewer.tsx`
Main component. Responsibilities:
- Fetch MusicXML text from URL
- Initialize OSMD, load, render into a container div
- Build timestamp map after render
- Subscribe to `transportStore.position`, convert to beat, update cursor
- Handle resize via debounced ResizeObserver → `osmd.render()`
- Lazy-loaded via `React.lazy()` to keep initial bundle small

### `src/store/scoreStore.ts`
```ts
interface ScoreState {
  visible: boolean;
  activeScoreFile: string | null;
  setVisible: (v: boolean) => void;
  setActiveScoreFile: (f: string | null) => void;
}
```

---

## Layout Integration

Place in `src/App.tsx` between TransportBar and MixerPanel:
```
Header (+ score toggle button, only when song has score files)
SongList
TransportBar (waveform)
ScoreViewer (collapsible, h-[400px] with internal scroll)
MixerPanel
```

If multiple score files are available (full score + individual parts), show a part selector dropdown.

---

## Existing Utilities to Reuse

| Utility | File | Purpose |
|---------|------|---------|
| `secondsToBeat()` | `src/audio/tempoUtils.ts` | Convert playhead seconds → beat number |
| `beatToSeconds()` | `src/audio/tempoUtils.ts` | Convert beat → seconds (for reverse lookup) |
| `generateBeatGrid()` | `src/audio/tempoUtils.ts` | Beat/bar grid with time signatures |
| `useTransportStore` | `src/store/transportStore.ts` | Playhead position, playing state, followPlayhead |
| `useSongStore` | `src/store/songStore.ts` | Selected song config with tempoMap, beatOffset |
| ResizeObserver pattern | `src/components/transport/WaveformTimeline.tsx` | Debounced resize handling for canvas/SVG |

---

## Risks and Considerations

### Beat Alignment
The MusicXML file's measure 1 must align with the audio's beat grid. The `beatOffset` in the song config handles the time gap before beat 0 in the audio. If the MusicXML has pickup measures or the audio has a count-in, a `scoreBeatOffset` field may be needed.

**Note**: The test song's `config.json` may have 120 BPM in its tempoMap but the MusicXML says 132 BPM. These must match or the cursor will drift.

### Bundle Size
OSMD + VexFlow is ~1-2MB. Must lazy-load so it doesn't affect initial page load.

### Live Recording Tempo Drift
If the audio has variable tempo (live recording) but the MusicXML assumes constant tempo, the cursor will drift. The `tapMap` system could provide per-measure time correction in the future — each tapMap `measure` entry gives the actual timestamp of that measure in the audio, which could override the constant-BPM calculation.

### Resize Cost
OSMD full re-render is ~100-500ms. Debounce resize events to 300ms and avoid re-rendering during active playback scroll.

---

## Implementation Order (When Ready)

1. `npm install opensheetmusicdisplay`
2. Extend `types.ts` and `schema.ts` with `scoreFile`
3. Build `scoreSync.ts` (can unit test independently)
4. Build `ScoreViewer.tsx` — static render first, then add cursor sync
5. Create `scoreStore.ts`
6. Integrate into `App.tsx` with toggle button
7. Update `song-test/config.json`
8. Test: load song → open score → play → verify cursor tracks → seek → verify jump
