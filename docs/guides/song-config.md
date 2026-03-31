# Song Configuration Guide

Each song in Practice Portal is defined by a `config.json` file located in its own directory under `public/audio/song-{id}/`. This file describes the song's metadata, audio stems, grouping, tempo, time signatures, metronome behavior, and timeline markers.

The config is validated at runtime using Zod schemas defined in `src/config/schema.ts` and typed in `src/audio/types.ts`.

## File Location

```
public/audio/
├── manifest.json                 # Index of all songs (see Manifest section below)
├── song-my-song/
│   ├── config.json               # This file
│   ├── drums.mp3                 # Audio stem files (referenced by config)
│   ├── bass.mp3
│   └── ...
```

## Full Schema

```jsonc
{
  // REQUIRED — Unique identifier for the song. Must match the directory name suffix
  // and the id used in manifest.json. Use kebab-case.
  "id": "blue-bossa",

  // REQUIRED — Display name shown in the song selector.
  "title": "Blue Bossa",

  // REQUIRED — Artist or composer name.
  "artist": "Kenny Dorham",

  // REQUIRED — Musical key (e.g., "Cm", "G", "Bb"). Use empty string if unknown.
  "key": "Cm",

  // REQUIRED — Total duration of the audio stems in seconds. All stems must be
  // the same length. Used for the seek bar and end-of-song detection.
  "durationSeconds": 245.5,

  // REQUIRED — At least one stem. See "Stems" section below.
  "stems": [ ... ],

  // OPTIONAL — Group stems together for collective control. See "Groups" section below.
  "groups": [ ... ],

  // REQUIRED — At least one entry. See "Tempo Map" section below.
  "tempoMap": [ ... ],

  // REQUIRED — At least one entry. See "Time Signature Map" section below.
  "timeSignatureMap": [ ... ],

  // REQUIRED — Metronome click configuration. See "Metronome" section below.
  "metronome": { ... },

  // REQUIRED — Array of timeline markers (can be empty). See "Markers" section below.
  "markers": [ ... ]
}
```

## Stems

Each stem represents a single audio track (instrument or voice) that plays in sync with all other stems.

```jsonc
{
  // Unique identifier within this song. Used internally and referenced by groups.
  // Use kebab-case (e.g., "hi-tom", "lead-vocal").
  "id": "bass",

  // Display label shown in the mixer UI.
  "label": "Bass",

  // Filename of the audio file, relative to this song's directory.
  // Supported formats: WAV, MP3, OGG, FLAC (anything the browser can decode).
  "file": "bass.mp3",

  // Initial volume level. Range: 0.0 (silent) to 1.0 (full).
  // Users can adjust up to 1.5 (150%) in the mixer UI.
  "defaultVolume": 0.8,

  // Initial stereo pan position. Range: -1.0 (hard left) to 1.0 (hard right).
  // 0.0 is center.
  "defaultPan": 0.0,

  // Hex color used for the stem's UI indicator dot and waveform display.
  "color": "#3b82f6"
}
```

### Important constraints

- All stem audio files **must be the same duration** and start at the same point in time. The engine starts all stems simultaneously with sample-accurate sync.
- `durationSeconds` in the top-level config should match the actual audio duration.
- Each `id` must be unique within the song's stems array.

## Groups

Groups let you bundle related stems (e.g., all drum microphones) under a single collapsible mixer control. Groups are optional — stems not assigned to any group appear as standalone mixer strips.

```jsonc
{
  // Unique identifier for the group.
  "id": "drums",

  // Display label shown on the group strip in the mixer.
  "label": "Drums",

  // Hex color for the group's UI indicator.
  "color": "#ef4444",

  // Array of stem IDs that belong to this group. Must reference valid stem IDs.
  // At least one stem ID is required.
  "stemIds": ["kick", "snare", "hi-tom", "lo-tom", "ovhd"]
}
```

### Group behavior

- **Volume**: The group volume acts as a multiplier on all child stem volumes. A group at 0.5 with a stem at 0.8 produces an effective volume of 0.4.
- **Mute**: Muting a group silences all child stems regardless of their individual mute state.
- **Solo**: Soloing a group makes only its child stems audible (subject to individual solo/mute within the group).
- **UI**: Groups render as a collapsible card. Clicking the expand arrow reveals individual stem controls.
- A stem should belong to at most one group. Behavior is undefined if a stem appears in multiple groups.

## Tempo Map

Defines the BPM (beats per minute) at specific beat positions. The metronome and future time-stretching features use this to stay in sync.

```jsonc
[
  // The first entry must start at beat 0.
  { "beat": 0, "bpm": 120 },

  // Additional entries represent tempo changes. The new BPM takes effect
  // at the specified beat position.
  { "beat": 64, "bpm": 140 }
]
```

- At least one entry is required.
- `beat` is a zero-indexed beat number (not a time in seconds).
- `bpm` must be at least 1.
- Entries should be sorted by beat position in ascending order.

### Converting between beats and seconds

For a constant tempo: `timeInSeconds = beat * (60 / bpm)`. When the tempo map has multiple entries, you must walk the map segment by segment, computing elapsed time for each segment at its respective BPM.

## Time Signature Map

Defines the time signature (meter) at specific beat positions. This affects how the metronome groups beats into measures.

```jsonc
[
  // The first entry must start at beat 0.
  { "beat": 0, "numerator": 4, "denominator": 4 },

  // A change to 6/8 at beat 32.
  { "beat": 32, "numerator": 6, "denominator": 8 }
]
```

- At least one entry is required.
- `numerator`: number of beats per measure (e.g., 4 for 4/4 time).
- `denominator`: note value that gets one beat (e.g., 4 for quarter note, 8 for eighth note).

## Metronome

Configures the metronome click sound, accent pattern, and subdivision.

```jsonc
{
  // Sound type for the click. Currently supported: "beep", "woodblock".
  "clickSound": "woodblock",

  // Relative volume for each beat in one measure. Array length should match
  // the time signature numerator. Values range from 0.0 (silent) to 1.0 (loudest).
  //
  // Example for 4/4: strong downbeat, soft 2 and 4, medium 3.
  "accentPattern": [1.0, 0.4, 0.6, 0.4],

  // Number of clicks per beat.
  // 1 = quarter notes only (one click per beat)
  // 2 = eighth note subdivisions
  // 3 = triplet subdivisions
  // 4 = sixteenth note subdivisions
  "subdivisions": 1
}
```

### Accent pattern tips

| Time Signature | Common Pattern | Description |
|---|---|---|
| 4/4 | `[1.0, 0.4, 0.6, 0.4]` | Strong 1, medium 3, soft 2 and 4 |
| 3/4 | `[1.0, 0.4, 0.4]` | Waltz: strong downbeat |
| 6/8 | `[1.0, 0.3, 0.3, 0.7, 0.3, 0.3]` | Two groups of three |
| 5/4 | `[1.0, 0.4, 0.6, 0.4, 0.4]` | Grouped as 3+2 |
| 7/8 | `[1.0, 0.3, 0.3, 0.7, 0.3, 0.7, 0.3]` | Grouped as 3+2+2 |

## Markers

Named positions on the timeline that users can click to jump to. Useful for marking song sections.

```jsonc
[
  { "name": "Intro", "beat": 0, "color": "#22c55e" },
  { "name": "Verse 1", "beat": 16, "color": "#3b82f6" },
  { "name": "Chorus", "beat": 48, "color": "#eab308" },
  { "name": "Solo", "beat": 80, "color": "#a855f7" }
]
```

- `beat`: beat position (zero-indexed). Converted to seconds using the tempo map.
- `color`: hex color for the marker indicator on the timeline.
- The array can be empty if no markers are needed.

## Manifest

Each song must also be registered in `public/audio/manifest.json`:

```jsonc
{
  "songs": [
    {
      // Must match the song's config.json id.
      "id": "blue-bossa",

      // Display title for the song selector dropdown.
      "title": "Blue Bossa",

      // Display artist name.
      "artist": "Kenny Dorham",

      // Path to the song's directory, relative to the public root.
      // Do not include a leading slash.
      "path": "audio/song-blue-bossa"
    }
  ]
}
```

The manifest is loaded once at app startup to populate the song selector. The full `config.json` and audio files are only fetched when the user selects a song.

## Complete Example

Below is a full, valid config for a song with 10 stems, one group, a constant tempo, and section markers:

```json
{
  "id": "st-james",
  "title": "St. James",
  "artist": "Unknown",
  "key": "",
  "durationSeconds": 331.58,
  "stems": [
    {
      "id": "kick",
      "label": "Kick",
      "file": "Scratch 01 - Kick.wav",
      "defaultVolume": 0.8,
      "defaultPan": 0.0,
      "color": "#ef4444"
    },
    {
      "id": "snare",
      "label": "Snare",
      "file": "Scratch 02 - Snare.wav",
      "defaultVolume": 0.8,
      "defaultPan": 0.0,
      "color": "#f97316"
    },
    {
      "id": "hi-tom",
      "label": "Hi Tom",
      "file": "Scratch 03 - Hi Tom.wav",
      "defaultVolume": 0.7,
      "defaultPan": -0.3,
      "color": "#eab308"
    },
    {
      "id": "lo-tom",
      "label": "Lo Tom",
      "file": "Scratch 04 - Lo Tom.wav",
      "defaultVolume": 0.7,
      "defaultPan": 0.3,
      "color": "#84cc16"
    },
    {
      "id": "ovhd",
      "label": "Overhead",
      "file": "Scratch 05 - OVHD.wav",
      "defaultVolume": 0.6,
      "defaultPan": 0.0,
      "color": "#22c55e"
    },
    {
      "id": "bass",
      "label": "Bass",
      "file": "Scratch 06 - Bass.wav",
      "defaultVolume": 0.8,
      "defaultPan": 0.0,
      "color": "#3b82f6"
    },
    {
      "id": "guitar",
      "label": "Guitar",
      "file": "Scratch 07 - Guitar.wav",
      "defaultVolume": 0.7,
      "defaultPan": -0.2,
      "color": "#8b5cf6"
    },
    {
      "id": "keys",
      "label": "Keys",
      "file": "Scratch 08 - Keys.wav",
      "defaultVolume": 0.7,
      "defaultPan": 0.2,
      "color": "#a855f7"
    },
    {
      "id": "horns",
      "label": "Horns",
      "file": "Scratch 09 - Horns.wav",
      "defaultVolume": 0.7,
      "defaultPan": 0.0,
      "color": "#ec4899"
    },
    {
      "id": "vox",
      "label": "Vocals",
      "file": "Scratch 10 - Vox.wav",
      "defaultVolume": 0.8,
      "defaultPan": 0.0,
      "color": "#f43f5e"
    }
  ],
  "groups": [
    {
      "id": "drums",
      "label": "Drums",
      "color": "#ef4444",
      "stemIds": ["kick", "snare", "hi-tom", "lo-tom", "ovhd"]
    }
  ],
  "tempoMap": [
    { "beat": 0, "bpm": 120 }
  ],
  "timeSignatureMap": [
    { "beat": 0, "numerator": 4, "denominator": 4 }
  ],
  "metronome": {
    "clickSound": "woodblock",
    "accentPattern": [1.0, 0.4, 0.6, 0.4],
    "subdivisions": 1
  },
  "markers": [
    { "name": "Start", "beat": 0, "color": "#22c55e" }
  ]
}
```
