/**
 * Default instrument stem ordering.
 *
 * Each entry maps a regex pattern to a sort priority (lower = higher in the list).
 * More specific patterns should appear before general ones within the same group.
 * This could be made per-band in the future.
 */

export interface StemOrderEntry {
  pattern: RegExp;
  priority: number;
}

export const defaultStemOrder: StemOrderEntry[] = [
  // Click / Metronome
  { pattern: /click|metronome|met\b|count/i, priority: 0 },

  // Drums — kit pieces
  { pattern: /kick|bd\b|bass.?drum/i, priority: 10 },
  { pattern: /snare|sn\b|sd\b/i, priority: 11 },
  { pattern: /hi.?hat|hh\b/i, priority: 12 },
  { pattern: /hi.?tom|rack.?tom/i, priority: 13 },
  { pattern: /lo.?tom|floor.?tom/i, priority: 14 },
  { pattern: /tom/i, priority: 15 },
  { pattern: /overhead|ovhd|oh\b|cymbal|ride|crash/i, priority: 16 },
  { pattern: /room\b|amb\b|ambient|drum.?room/i, priority: 17 },
  { pattern: /drum|drm\b|kit\b/i, priority: 18 },

  // Percussion
  { pattern: /perc|conga|bongo|shaker|tamb|cowbell|timbale|cajon|clap|snap/i, priority: 20 },

  // Bass
  { pattern: /bass|sub\b/i, priority: 30 },

  // Guitar
  { pattern: /rhythm.?g(ui)?t(a)?r|rhy.?gtr|rgtr/i, priority: 40 },
  { pattern: /lead.?g(ui)?t(a)?r|lead.?gtr|lgtr/i, priority: 41 },
  { pattern: /gtr|guitar|acous/i, priority: 42 },

  // Keys / Piano
  { pattern: /piano|pno\b|keys|kbd|keyboard|organ|rhodes|wurli|clav|synth|pad\b|moog/i, priority: 50 },

  // Woodwinds (reverse score order — low to high)
  { pattern: /bassoon|bsn\b/i, priority: 60 },
  { pattern: /bari.?sax|bsax/i, priority: 61 },
  { pattern: /tenor.?sax|tsax/i, priority: 62 },
  { pattern: /alto.?sax|asax/i, priority: 63 },
  { pattern: /soprano.?sax|ssax/i, priority: 64 },
  { pattern: /sax/i, priority: 65 },
  { pattern: /clarinet|clar\b/i, priority: 66 },
  { pattern: /oboe/i, priority: 67 },
  { pattern: /flute|piccolo|picc\b/i, priority: 68 },

  // Brass (reverse score order — low to high)
  { pattern: /tuba|sousa|sooza|sousaphone/i, priority: 70 },
  { pattern: /euphonium|euph\b/i, priority: 71 },
  { pattern: /trombone|trb\b|tbn\b|bone\b/i, priority: 72 },
  { pattern: /french.?horn|fhr\b/i, priority: 73 },
  { pattern: /trumpet|trp\b|tpt\b|trpt\b|flugelhorn|flugel|cornet/i, priority: 74 },
  { pattern: /horn|brass/i, priority: 75 },

  // Strings
  { pattern: /violin|vln\b|vn\b/i, priority: 80 },
  { pattern: /viola|vla\b|va\b/i, priority: 81 },
  { pattern: /cello|vc\b|vlc\b/i, priority: 82 },
  { pattern: /contrabass|cb\b/i, priority: 83 },
  { pattern: /string/i, priority: 84 },

  // Vocals
  { pattern: /lead.?vo[cx]|lead.?vocal|main.?vo[cx]/i, priority: 90 },
  { pattern: /b(acking)?\.?vo[cx]|bgv|backup|chorus.?vo[cx]/i, priority: 91 },
  { pattern: /vo[cx]|vocal|voice|sing/i, priority: 92 },

  // FX / Other
  { pattern: /fx\b|sfx|effect/i, priority: 100 },
];
