export interface StemConfig {
  id: string;
  label: string;
  file: string;
  defaultVolume: number;
  defaultPan: number;
  color: string;
  stereo?: boolean;
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
  title: string;
  artist: string;
  key: string;
  durationSeconds: number;
  beatOffset: number;
  stems: StemConfig[];
  groups?: StemGroupConfig[];
  tempoMap: TempoMapEntry[];
  timeSignatureMap: TimeSignatureEntry[];
  metronome: MetronomeConfig;
  markers: MarkerConfig[];
  tapMap?: TapMapEntry[];
  navLinks?: NavLinkConfig[];
}

export interface SongManifestEntry {
  id: string;
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
  songIds: string[];
}

export interface BandsManifest {
  bands: BandConfig[];
}

export type SetlistEntry =
  | { type: 'song'; songId: string }
  | { type: 'heading'; label: string };

export interface SetlistConfig {
  id: string;
  name: string;
  entries: SetlistEntry[];
  navLinks?: NavLinkConfig[];
}

export interface SetlistIndex {
  setlists: { id: string; name: string }[];
}
