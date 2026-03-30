export interface StemConfig {
  id: string;
  label: string;
  file: string;
  defaultVolume: number;
  defaultPan: number;
  color: string;
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

export interface SongConfig {
  id: string;
  title: string;
  artist: string;
  key: string;
  durationSeconds: number;
  stems: StemConfig[];
  groups?: StemGroupConfig[];
  tempoMap: TempoMapEntry[];
  timeSignatureMap: TimeSignatureEntry[];
  metronome: MetronomeConfig;
  markers: MarkerConfig[];
}

export interface SongManifestEntry {
  id: string;
  title: string;
  artist: string;
  path: string;
}

export interface SongManifest {
  songs: SongManifestEntry[];
}
