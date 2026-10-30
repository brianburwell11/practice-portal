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

export const noteSchema = z.object({
  id: z.string().min(1),
  time: z.number().min(0),
  text: z.string(),
  /** Who added it (app_user id). Absent on notes from before notes had authors. */
  authorId: z.string().optional(),
  /** Set when deleted, so Undo can bring it back; reads leave these out. */
  deletedAt: z.string().optional(),
});

/** The longest a note's text may be. */
export const NOTE_TEXT_MAX = 200;

/** What a client sends to add or edit a note. */
export const noteWriteSchema = z.object({
  time: z.number().min(0).max(24 * 60 * 60),
  text: z.string().trim().min(1, 'A note needs some text').max(NOTE_TEXT_MAX),
});

export const notesDataSchema = z.object({
  notes: z.array(noteSchema),
});

export const navLinkConfigSchema = z.object({
  title: z.string().min(1).max(40),
  url: z.string().url(),
});

export const videoSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  title: z.string().optional(),
  offsetSeconds: z.number(),
  addedAt: z.string(),
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
  videos: z.array(videoSchema).optional(),
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

/** A song id is one path segment of its media prefix, so no `/` or `..`. */
export const songIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

export const songManifestEntrySchema = z.object({
  id: songIdSchema,
  slug: slugSchema,
  title: z.string(),
  artist: z.string(),
  audioBasePath: z.string().optional(),
  /** The song's tags, which the player offers as collections. */
  tags: z.array(z.string()).optional(),
});

// A new band has no songs yet, so an empty list is valid.
export const songManifestSchema = z.object({
  songs: z.array(songManifestEntrySchema),
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

const httpUrl = z.string().max(2048).refine((u) => /^https?:\/\//i.test(u), 'Must start with http:// or https://');

/**
 * What the server accepts when a band is saved: `bandConfigSchema` with
 * limits. Reads stay lenient, so an older record never stops a page loading.
 */
export const bandConfigWriteSchema = bandConfigSchema.extend({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid band id'),
  name: z.string().trim().min(1).max(80),
  route: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, 'Use letters, numbers, dots, dashes or underscores (at most 60)'),
  colors: z.object({
    primary: z.string().max(32),
    accent: z.string().max(32),
    background: z.string().max(32),
    text: z.string().max(32),
  }),
  logo: httpUrl.optional(),
  website: z.union([httpUrl, z.literal('')]).optional(),
  palette: z.array(z.string().max(32)).max(64).optional(),
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
