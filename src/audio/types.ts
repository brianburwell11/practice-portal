export interface StemConfig {
  id: string;
  label: string;
  file: string;
  defaultVolume: number;
  defaultPan: number;
  color: string;
  stereo?: boolean;
  /** Alignment offset in seconds. Positive delays start, negative seeks into the buffer. */
  offsetSec?: number;
}

export interface TempoMapEntry {
  beat: number;
  bpm: number;
}

export interface TimeSignatureEntry {
  beat: number;
  numerator: number;
  denominator: number;
}

export interface MetronomeConfig {
  clickSound: string;
  accentPattern: number[];
  subdivisions: number;
}

export interface MarkerConfig {
  name: string;
  beat: number;
  color: string;
}

export interface StemGroupConfig {
  id: string;
  label: string;
  color: string;
  stemIds: string[];
  defaultVolume?: number;
}

export interface TapMapEntry {
  time: number;                              // seconds into the audio
  type: 'section' | 'measure' | 'beat';      // hierarchy: section > measure > beat
  label?: string;                            // only for sections
}

export interface NavLinkConfig {
  title: string;
  url: string;
}

export interface SongConfig {
  id: string;
  /** Kebab-case URL segment, editable. Optional for legacy songs
   *  whose `id` is itself a slug. */
  slug?: string;
  title: string;
  artist: string;
  key: string;
  durationSeconds: number;
  beatOffset: number;
  stems: StemConfig[];
  groups?: StemGroupConfig[];
  /**
   * Top-level display order for the mixer: an array of group IDs and
   * standalone (ungrouped) stem IDs. When unset, the legacy default is
   * used: groups first (in `groups` order), then ungrouped stems
   * (in `stems` order). IDs not present in `stems`/`groups` are
   * ignored; missing IDs are appended using the legacy default so a
   * newly added stem/group never disappears.
   */
  mixerOrder?: string[];
  tempoMap: TempoMapEntry[];
  timeSignatureMap: TimeSignatureEntry[];
  metronome: MetronomeConfig;
  markers: MarkerConfig[];
  tapMap?: TapMapEntry[];
  navLinks?: NavLinkConfig[];
  tags?: string[];
  sheetMusicUrl?: string;
  audioOffsetSeconds?: number;
  equalBeatWidth?: boolean;
  /** When true, internal repeats / voltas are re-taken on the return
   *  pass after a D.C. / D.S. jump. Default (unset / false) matches
   *  the usual convention where D.C./D.S. walks straight through. */
  repeatAfterDcDs?: boolean;
}

export interface SongManifestEntry {
  id: string;
  slug?: string;
  title: string;
  artist: string;
  audioBasePath?: string;
}

export interface SongManifest {
  songs: SongManifestEntry[];
}

export interface BandColors {
  primary: string;
  accent: string;
  background: string;
  text: string;
}

export interface BandConfig {
  id: string;
  name: string;
  route: string;
  colors: BandColors;
  logo?: string;
  website?: string;
  palette?: string[];
}

export interface BandIndexEntry {
  id: string;
  name: string;
  route: string;
  logo?: string;
  background: string;
  text: string;
}

export interface BandsManifest {
  bands: BandIndexEntry[];
}

export type SetlistEntry =
  | { type: 'song'; songId: string }
  | { type: 'heading'; label: string };

export interface SetlistConfig {
  id: string;
  slug?: string;
  name: string;
  entries: SetlistEntry[];
  navLinks?: NavLinkConfig[];
  desiredLengthSeconds?: number;
}

export interface SetlistIndex {
  setlists: { id: string; slug?: string; name: string }[];
}
