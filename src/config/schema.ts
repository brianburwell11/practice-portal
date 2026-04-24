import { z } from 'zod';

export const stemConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  file: z.string(),
  defaultVolume: z.number().min(0).max(1.5),
  defaultPan: z.number().min(-1).max(1),
  color: z.string(),
  stereo: z.boolean().optional(),
  /** Alignment offset in seconds. Positive delays start, negative seeks into the buffer. */
  offsetSec: z.number().optional(),
});

export const tempoMapEntrySchema = z.object({
  beat: z.number().min(0),
  bpm: z.number().min(1),
});

export const timeSignatureEntrySchema = z.object({
  beat: z.number().min(0),
  numerator: z.number().min(1),
  denominator: z.number().min(1),
});

export const metronomeConfigSchema = z.object({
  clickSound: z.string(),
  accentPattern: z.array(z.number().min(0).max(1)),
  subdivisions: z.number().min(1),
});

export const markerConfigSchema = z.object({
  name: z.string(),
  beat: z.number().min(0),
  color: z.string(),
});

export const stemGroupConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  stemIds: z.array(z.string()).min(1),
  defaultVolume: z.number().min(0).max(1.5).optional(),
});

export const tapMapEntrySchema = z.object({
  time: z.number().min(0),
  type: z.enum(['section', 'measure', 'beat']),
  label: z.string().optional(),
});

export const lyricsLineSchema = z.object({
  text: z.string(),
  time: z.number().min(0).nullable(),
  instrumental: z.boolean().optional(),
});

export const lyricsDataSchema = z.object({
  lines: z.array(lyricsLineSchema),
});

export const navLinkConfigSchema = z.object({
  title: z.string().min(1).max(40),
  url: z.string().url(),
});

const slugSchema = z.string().regex(/^[a-z0-9-]+$/).optional();

export const songConfigSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  title: z.string(),
  artist: z.string(),
  key: z.string(),
  durationSeconds: z.number().positive(),
  beatOffset: z.number().min(0).default(0),
  stems: z.array(stemConfigSchema).min(1),
  groups: z.array(stemGroupConfigSchema).optional(),
  /** Top-level mixer display order: a list of group IDs and ungrouped
   *  stem IDs. Missing/unknown IDs are tolerated at runtime. */
  mixerOrder: z.array(z.string()).optional(),
  tempoMap: z.array(tempoMapEntrySchema).min(1),
  timeSignatureMap: z.array(timeSignatureEntrySchema).min(1),
  metronome: metronomeConfigSchema,
  markers: z.array(markerConfigSchema),
  tapMap: z.array(tapMapEntrySchema).optional(),
  navLinks: z.array(navLinkConfigSchema).optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  /** Path (relative to the song's audio base) of a MusicXML score to render
   *  in the scrolling-score panel. If absent, the panel is hidden. */
  sheetMusicUrl: z.string().optional(),
  /** Seconds of silence / count-in before the score's first downbeat. When
   *  absent, falls back to the first measure-tap time in tapMap. */
  audioOffsetSeconds: z.number().optional(),
  /** Force OSMD's FixedMeasureWidth flag for this song. Dense songs should
   *  leave this off; sparse songs benefit from turning it on. */
  equalBeatWidth: z.boolean().optional(),
  /** When true, internal repeats (`|: :|`, voltas) are re-taken after a
   *  D.C. / D.S. jump. Default (unset / false) matches the usual convention
   *  where internal repeats are honored only on the first pass and the
   *  D.C./D.S. return walks straight through. */
  repeatAfterDcDs: z.boolean().optional(),
});

export const songManifestEntrySchema = z.object({
  id: z.string(),
  slug: slugSchema,
  title: z.string(),
  artist: z.string(),
  audioBasePath: z.string().optional(),
});

export const songManifestSchema = z.object({
  songs: z.array(songManifestEntrySchema).min(1),
});

export const bandColorsSchema = z.object({
  primary: z.string(),
  accent: z.string(),
  background: z.string(),
  text: z.string(),
});

export const bandConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  route: z.string(),
  colors: bandColorsSchema,
  logo: z.string().optional(),
  website: z.string().optional(),
  palette: z.array(z.string()).optional(),
});

export const bandIndexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  route: z.string(),
  logo: z.string().optional(),
  background: z.string(),
  text: z.string(),
});

export const bandsManifestSchema = z.object({
  bands: z.array(bandIndexEntrySchema),
});

export const setlistEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('song'), songId: z.string() }),
  z.object({ type: z.literal('heading'), label: z.string() }),
]);

export const setlistConfigSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  name: z.string(),
  entries: z.array(setlistEntrySchema),
  navLinks: z.array(navLinkConfigSchema).optional(),
  desiredLengthSeconds: z.number().min(0).optional(),
});

export const setlistIndexSchema = z.object({
  setlists: z.array(
    z.object({ id: z.string(), slug: slugSchema, name: z.string() }),
  ),
});
