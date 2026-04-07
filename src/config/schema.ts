import { z } from 'zod';

export const stemConfigSchema = z.object({
  id: z.string(),
  label: z.string(),
  file: z.string(),
  defaultVolume: z.number().min(0).max(1),
  defaultPan: z.number().min(-1).max(1),
  color: z.string(),
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
});

export const tapMapEntrySchema = z.object({
  time: z.number().min(0),
  type: z.enum(['section', 'measure', 'beat']),
  label: z.string().optional(),
});

export const songConfigSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  key: z.string(),
  durationSeconds: z.number().positive(),
  beatOffset: z.number().min(0).default(0),
  stems: z.array(stemConfigSchema).min(1),
  groups: z.array(stemGroupConfigSchema).optional(),
  tempoMap: z.array(tempoMapEntrySchema).min(1),
  timeSignatureMap: z.array(timeSignatureEntrySchema).min(1),
  metronome: metronomeConfigSchema,
  markers: z.array(markerConfigSchema),
  tapMap: z.array(tapMapEntrySchema).optional(),
});

export const songManifestEntrySchema = z.object({
  id: z.string(),
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
  songIds: z.array(z.string()),
});

export const bandsManifestSchema = z.object({
  bands: z.array(bandConfigSchema),
});

export const setlistEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('song'), songId: z.string() }),
  z.object({ type: z.literal('heading'), label: z.string() }),
]);

export const setlistConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  entries: z.array(setlistEntrySchema),
});

export const setlistIndexSchema = z.object({
  setlists: z.array(z.object({ id: z.string(), name: z.string() })),
});
