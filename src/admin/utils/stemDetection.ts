export interface StemDefaults {
  id: string;
  label: string;
  color: string;
  defaultVolume: number;
  defaultPan: number;
}

interface InstrumentMatch {
  pattern: RegExp;
  label: string;
  color: string;
  defaultVolume: number;
  defaultPan: number;
}

const instrumentTable: InstrumentMatch[] = [
  { pattern: /kick/i, label: 'Kick', color: '#ef4444', defaultVolume: 0.8, defaultPan: 0 },
  { pattern: /snare/i, label: 'Snare', color: '#f97316', defaultVolume: 0.8, defaultPan: 0 },
  { pattern: /hi[- ]?hat|hh/i, label: 'Hi-Hat', color: '#facc15', defaultVolume: 0.6, defaultPan: 0 },
  { pattern: /hi[- ]?tom/i, label: 'Hi Tom', color: '#eab308', defaultVolume: 0.7, defaultPan: -0.3 },
  { pattern: /lo[- ]?tom|floor[- ]?tom/i, label: 'Lo Tom', color: '#84cc16', defaultVolume: 0.7, defaultPan: 0.3 },
  { pattern: /tom/i, label: 'Tom', color: '#eab308', defaultVolume: 0.7, defaultPan: 0 },
  { pattern: /ovhd|overhead|oh\b/i, label: 'Overhead', color: '#22c55e', defaultVolume: 0.6, defaultPan: 0 },
  { pattern: /bass/i, label: 'Bass', color: '#3b82f6', defaultVolume: 0.8, defaultPan: 0 },
  { pattern: /guitar|gtr/i, label: 'Guitar', color: '#8b5cf6', defaultVolume: 0.7, defaultPan: -0.2 },
  { pattern: /keys|piano|kbd|keyboard/i, label: 'Keys', color: '#a855f7', defaultVolume: 0.7, defaultPan: 0.2 },
  { pattern: /vox|vocal/i, label: 'Vocals', color: '#f43f5e', defaultVolume: 0.8, defaultPan: 0 },
  { pattern: /horn|brass|sax|trumpet|trombone/i, label: 'Horns', color: '#ec4899', defaultVolume: 0.7, defaultPan: 0 },
];

const audioExtensions = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aiff', '.aif', '.m4a']);

export function isAudioFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return audioExtensions.has(ext);
}

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function detectStem(filename: string): StemDefaults {
  // Strip extension
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');

  // Try splitting on " - " to get the meaningful part (e.g., "Scratch 06 - Bass" → "Bass")
  const parts = nameWithoutExt.split(' - ');
  const candidate = parts.length > 1 ? parts[parts.length - 1].trim() : nameWithoutExt;

  for (const match of instrumentTable) {
    if (match.pattern.test(candidate)) {
      return {
        id: toKebab(match.label),
        label: match.label,
        color: match.color,
        defaultVolume: match.defaultVolume,
        defaultPan: match.defaultPan,
      };
    }
  }

  // Fallback: use the candidate as the label
  const label = candidate.replace(/[_-]/g, ' ').trim() || filename;
  return {
    id: toKebab(label),
    label,
    color: '#6b7280',
    defaultVolume: 0.7,
    defaultPan: 0,
  };
}

/** Ensure all stem IDs are unique by appending a suffix if needed. */
export function deduplicateIds(stems: StemDefaults[]): StemDefaults[] {
  const seen = new Map<string, number>();
  return stems.map((stem) => {
    const count = seen.get(stem.id) ?? 0;
    seen.set(stem.id, count + 1);
    if (count === 0) return stem;
    return { ...stem, id: `${stem.id}-${count + 1}` };
  });
}
