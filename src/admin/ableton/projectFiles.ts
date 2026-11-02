/**
 * Dropped files for an Ableton import: collecting a folder drop with its
 * relative paths, finding the set, resolving each clip's sample, and
 * spotting "Export All Individual Tracks" files among the drop.
 */
import type { AbletonSet, AlsAudioClip, AlsTrack } from './alsParser';
import { isAudioFile } from '../utils/stemDetection';

export interface DroppedFile {
  /** Path from the drop root, e.g. `Gunk Palace Project/Samples/Imported/1.aif`. */
  path: string;
  file: File;
}

/** Walk a drop (files and folders), skipping Live's .asd analysis files and dotfiles. */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < dataTransfer.items.length; i++) {
    const entry = dataTransfer.items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  async function readEntry(entry: FileSystemEntry): Promise<void> {
    if (entry.name.startsWith('.') || entry.name.endsWith('.asd')) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      out.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call; read until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        if (batch.length === 0) break;
        for (const child of batch) await readEntry(child);
      }
    }
  }

  for (const entry of entries) await readEntry(entry);
  return out;
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Join and collapse `.` / `..` segments. */
function joinPath(base: string, relative: string): string {
  const parts: string[] = [];
  for (const seg of `${base}/${relative}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Every Live Set in the drop, ignoring `Backup/`, shallowest first. */
export function findSets(files: DroppedFile[]): DroppedFile[] {
  return files
    .filter((f) => /\.als$/i.test(f.path) && !f.path.split('/').includes('Backup'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
}

/**
 * Where a clip's sample should be, as a path in the drop. Paths that climb
 * out of the project (Live sets often use shared folders like
 * `../../Sooza Resources/Guides`) come out relative to the drop root.
 */
export function expectedPath(clip: AlsAudioClip, als: DroppedFile): string {
  if (clip.file.relativePath) return joinPath(dirname(als.path), clip.file.relativePath);
  return clip.file.path.replace(/^\/+/, '');
}

export type ClipResolver = (clip: AlsAudioClip) => File | null;

/** Number of trailing path segments two paths share, ignoring case. */
function sharedSuffix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n].toLowerCase() === b[b.length - 1 - n].toLowerCase()) n++;
  return n;
}

/**
 * Find a clip's sample among the dropped files. The candidate whose path
 * shares the longest tail with where the set expects it wins, so samples
 * are found whether the drop is the project folder alone, the project plus
 * a shared samples folder, or a parent folder holding both. A bare file
 * name match only counts when it's the only file with that name.
 */
export function makeResolver(files: DroppedFile[], als: DroppedFile): ClipResolver {
  const byName = new Map<string, DroppedFile[]>();
  for (const f of files) {
    if (!isAudioFile(f.file.name)) continue;
    const key = f.file.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(f);
    byName.set(key, list);
  }
  const cache = new Map<string, File | null>();
  return (clip) => {
    const key = clip.file.relativePath || clip.file.path;
    if (cache.has(key)) return cache.get(key)!;
    const name = clip.file.name || basename(key);
    const candidates = byName.get(name.toLowerCase()) ?? [];
    const targets = [expectedPath(clip, als), clip.file.path]
      .filter(Boolean)
      .map((t) => t.split('/').filter(Boolean));
    let best = 0;
    let bestFiles: DroppedFile[] = [];
    for (const c of candidates) {
      const segs = c.path.split('/');
      const score = Math.max(...targets.map((t) => sharedSuffix(segs, t)));
      if (score > best) {
        best = score;
        bestFiles = [c];
      } else if (score === best) {
        bestFiles.push(c);
      }
    }
    const found = best >= 2 || bestFiles.length === 1 ? (bestFiles[0]?.file ?? null) : null;
    cache.set(key, found);
    return found;
  };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '');
}

/**
 * Match Ableton track exports among the dropped files by track name. Live
 * names them like `1-TRUMPET 1.wav` or `Gunk Palace TRUMPET 1.wav`. Only
 * files inside the project folder count, outside `Samples/` and `Backup/`:
 * shared folders dropped alongside the project are full of raw stems with
 * track-like names (`Stems/Song/Drums.aif`) that must not replace the
 * rendered arrangement. Exports kept anywhere else can be dropped on a row.
 */
export function matchExports(
  files: DroppedFile[],
  als: DroppedFile,
  set: AbletonSet,
  setName: string,
  tracks: AlsTrack[],
  resolve: ClipResolver,
): Map<string, File> {
  const used = new Set<File>();
  for (const t of set.tracks) for (const c of t.clips) {
    const f = resolve(c);
    if (f) used.add(f);
  }
  const setKey = normalizeName(setName);
  const root = dirname(als.path);
  const candidates = files.filter((f) => {
    if (root && !f.path.startsWith(`${root}/`)) return false;
    const dirs = f.path.slice(root ? root.length + 1 : 0).split('/').slice(0, -1);
    return isAudioFile(f.file.name) && !used.has(f.file) && !dirs.includes('Samples') && !dirs.includes('Backup');
  });

  const matches = new Map<string, File>();
  for (const track of tracks) {
    const key = normalizeName(track.name);
    if (!key) continue;
    const hit = candidates.find((f) => {
      const stem = f.file.name.replace(/^\d+\s*-\s*/, '');
      const name = normalizeName(stem);
      return name === key || (setKey && name === setKey + key);
    });
    if (hit) matches.set(track.id, hit.file);
  }
  return matches;
}
