import type { StemOrderEntry } from '../../config/stemOrder';
import { defaultStemOrder } from '../../config/stemOrder';

export interface StemDefaults {
  id: string;
  label: string;
  color: string;
  defaultVolume: number;
  defaultPan: number;
}

const audioExtensions = new Set(['.wav', '.mp3', '.ogg', '.opus', '.flac', '.aiff', '.aif', '.m4a']);

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

  // Use the cleaned filename as the label (no instrument guessing)
  const label = candidate.replace(/[_-]/g, ' ').trim() || filename;
  return {
    id: toKebab(label),
    label,
    color: '#6b7280',
    defaultVolume: 0.7,
    defaultPan: 0,
  };
}

/**
 * Sort stems by natural track number if present, otherwise by instrument priority.
 * T must have a `file: File` and `label: string` (i.e. StemEntry from the wizard).
 */
export function sortStems<T extends { file: File; label: string }>(
  stems: T[],
  order: StemOrderEntry[] = defaultStemOrder,
): T[] {
  // Check if every filename has a parseable track number
  const numbers = stems.map((s) => {
    const name = s.file.name.replace(/\.[^.]+$/, '');
    // Match leading number ("01-Kick") or number after " - " ("Scratch 06 - Kick")
    const m = name.match(/^(\d+)/) || name.match(/\b(\d+)\s*-\s*[^-]/);
    return m ? parseInt(m[1], 10) : null;
  });

  const allHaveNumbers = numbers.every((n) => n !== null);
  if (allHaveNumbers) {
    const indexed = stems.map((s, i) => ({ s, n: numbers[i]! }));
    indexed.sort((a, b) => a.n - b.n);
    return indexed.map((x) => x.s);
  }

  // Otherwise sort by instrument priority
  const UNMATCHED = 999;
  function getPriority(label: string): number {
    for (const entry of order) {
      if (entry.pattern.test(label)) return entry.priority;
    }
    return UNMATCHED;
  }

  const indexed = stems.map((s, i) => ({ s, p: getPriority(s.label), i }));
  indexed.sort((a, b) => a.p - b.p || a.i - b.i);
  return indexed.map((x) => x.s);
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

/**
 * When two or more stems slug to the same id, suffix every member of the
 * collision set with "-1", "-2", … (keeping solo labels untouched). Both
 * `label` and `id` are updated so the UI and saved config agree.
 */
export function deduplicateLabels<T extends { label: string; id: string }>(stems: T[]): T[] {
  const groupIndices = new Map<string, number[]>();
  stems.forEach((s, i) => {
    const key = toKebab(s.label) || s.id;
    const arr = groupIndices.get(key);
    if (arr) arr.push(i);
    else groupIndices.set(key, [i]);
  });

  const result = stems.slice();
  for (const indices of groupIndices.values()) {
    if (indices.length < 2) continue;
    indices.forEach((idx, n) => {
      const suffix = n + 1;
      const label = `${result[idx].label}-${suffix}`;
      result[idx] = { ...result[idx], label, id: toKebab(label) || result[idx].id };
    });
  }
  return result;
}
