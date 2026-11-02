/**
 * The import checklist: which Ableton tracks can become stems, and what
 * the importer knows about each before rendering.
 */
import type { AbletonSet, AlsTrack } from './alsParser';
import type { ClipResolver } from './projectFiles';
import { TempoMap, planClip } from './timeline';
import { playableClips } from './renderTrack';

export interface ImportRow {
  track: AlsTrack;
  /** Immediate parent group track, if any. */
  group: AlsTrack | null;
  label: string;
  playableCount: number;
  /** Sample file names the drop didn't include. */
  missing: string[];
  /** Sample file names that are encrypted Ableton Pack audio. */
  protectedFiles: string[];
  /** Muted itself or inside a muted group. */
  muted: boolean;
  /** Last beat with sound, for sizing the render. */
  endBeat: number;
  warnings: string[];
}

/**
 * A stem label from a track name: drops Live's `16-` consolidate prefix,
 * the `[2024-12-04 143709]` timestamp and the set's own name.
 */
export function cleanTrackLabel(name: string, setName: string): string {
  let label = name
    .replace(/^\d+-/, '')
    .replace(/\s*\[\d{4}-\d{2}-\d{2}[^\]]*\]\s*$/, '')
    .trim();
  if (setName) {
    const without = label.replace(new RegExp(`\\s*${setName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), ' ').trim();
    if (without) label = without;
  }
  return label || name;
}

export function setNameFromFile(fileName: string): string {
  return fileName.replace(/\.als$/i, '');
}

/**
 * `resolve` finds a clip's file; `isProtected` flags files that can't be
 * decoded (encrypted Pack audio), which count as neither playable nor
 * missing.
 */
export function buildRows(
  set: AbletonSet,
  setName: string,
  resolve: ClipResolver,
  isProtected: (file: File) => boolean = () => false,
): ImportRow[] {
  const usable: ClipResolver = (clip) => {
    const file = resolve(clip);
    return file && !isProtected(file) ? file : null;
  };
  const byId = new Map(set.tracks.map((t) => [t.id, t]));
  const tempo = new TempoMap(set.tempo);

  const mutedUp = (track: AlsTrack): boolean => {
    for (let t: AlsTrack | undefined = track; t; t = t.groupId ? byId.get(t.groupId) : undefined) {
      if (t.muted) return true;
    }
    return false;
  };

  return set.tracks
    .filter((t) => t.kind === 'audio' && t.clips.length > 0)
    .map((track) => {
      const playable = playableClips(track, usable);
      const missing = [
        ...new Set(track.clips.filter((c) => !c.disabled && !resolve(c)).map((c) => c.file.name)),
      ];
      return {
        track,
        group: track.groupId ? byId.get(track.groupId) ?? null : null,
        label: cleanTrackLabel(track.name, setName),
        playableCount: playable.length,
        missing,
        protectedFiles: [
          ...new Set(
            track.clips
              .filter((c) => !c.disabled && resolve(c) && isProtected(resolve(c)!))
              .map((c) => c.file.name),
          ),
        ],
        muted: mutedUp(track),
        endBeat: Math.max(0, ...playable.map((c) => c.end)),
        warnings: playable.flatMap((c) => planClip(c, tempo).warnings),
      };
    });
}
