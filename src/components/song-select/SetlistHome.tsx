import { useEffect, useMemo, useState } from 'react';
import { useBandStore } from '../../store/bandStore';
import { useSongStore } from '../../store/songStore';
import { useSetlistStore } from '../../store/setlistStore';
import { useSongLoader } from './SongList';
import { dataUrl } from '../../utils/url';
import { formatTime } from '../../utils/formatTime';
import { getCamelotStyle } from '../../utils/camelot';
import type { SetlistConfig, SongManifestEntry } from '../../audio/types';
import { SetlistOfflineToggle } from '../../offline/OfflineToggle';
import { collectionLabel } from '../../utils/collections';

interface SongMeta {
  key: string;
  durationSeconds: number;
}

type Row =
  | { type: 'heading'; label: string }
  | { type: 'song'; idx: number; song: SongManifestEntry };

/**
 * A setlist's home: its songs in order, with their headings, keys and
 * lengths. Shown while a setlist is open and no song is. Picking a song
 * opens it at its place in the setlist.
 */
export function SetlistHome({ setlist }: { setlist: SetlistConfig }) {
  const { handleSelect } = useSongLoader();
  const manifest = useSongStore((s) => s.manifest);
  const setActiveIndex = useSetlistStore((s) => s.setActiveIndex);

  // Same numbering as the song dropdown: songs missing from the manifest
  // are skipped, so `idx` lines up with `filteredSongs`.
  const rows = useMemo(() => {
    const out: Row[] = [];
    let idx = 0;
    for (const entry of setlist.entries) {
      if (entry.type === 'heading') {
        out.push({ type: 'heading', label: entry.label });
      } else {
        const song = manifest?.songs.find((s) => s.id === entry.songId);
        if (song) out.push({ type: 'song', idx: idx++, song });
      }
    }
    return out;
  }, [setlist, manifest]);

  return (
    <SongsHome
      title={setlist.name}
      rows={rows}
      aside={<SetlistOfflineToggle setlist={setlist} />}
      onOpen={(idx, song) => {
        setActiveIndex(idx);
        handleSelect(song);
      }}
    />
  );
}

/**
 * The band's home when no setlist is open and no song is: every song A–Z
 * (or the open collection's), with keys and lengths, like a setlist's home.
 */
export function AllSongsHome() {
  const { filteredSongs, handleSelect } = useSongLoader();
  const activeTag = useSetlistStore((s) => s.activeTag);
  const rows = useMemo<Row[]>(() => filteredSongs.map((song, idx) => ({ type: 'song', idx, song })), [filteredSongs]);
  return (
    <SongsHome
      title={activeTag ? collectionLabel(activeTag) : 'All songs'}
      rows={rows}
      onOpen={(_, song) => handleSelect(song)}
    />
  );
}

function SongsHome({ title, rows, aside, onOpen }: {
  title: string;
  rows: Row[];
  aside?: React.ReactNode;
  onOpen: (idx: number, song: SongManifestEntry) => void;
}) {
  const bandId = useBandStore((s) => s.currentBand?.id);

  // The manifest has no keys or lengths; they live in each song's config.
  const [meta, setMeta] = useState<Record<string, SongMeta>>({});
  useEffect(() => {
    if (!bandId) return;
    let cancelled = false;
    const ids = [...new Set(rows.flatMap((r) => (r.type === 'song' ? [r.song.id] : [])))];
    Promise.all(
      ids.map(async (id): Promise<[string, SongMeta] | null> => {
        try {
          const res = await fetch(dataUrl(`${bandId}/songs/${id}/config.json`));
          if (!res.ok) return null;
          const config = await res.json();
          return [id, { key: config.key ?? '', durationSeconds: config.durationSeconds ?? 0 }];
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!cancelled) setMeta(Object.fromEntries(results.filter((r) => r !== null)));
    });
    return () => { cancelled = true; };
  }, [rows, bandId]);

  const totalSeconds = rows.reduce(
    (sum, r) => sum + (r.type === 'song' ? meta[r.song.id]?.durationSeconds ?? 0 : 0),
    0,
  );
  const songCount = rows.filter((r) => r.type === 'song').length;

  // Each heading's set: the songs after it, up to the next heading.
  const setSeconds = useMemo(() => {
    const out = new Map<number, number>();
    let heading = -1;
    rows.forEach((r, i) => {
      if (r.type === 'heading') {
        heading = i;
        out.set(i, 0);
      } else if (heading >= 0) {
        out.set(heading, out.get(heading)! + (meta[r.song.id]?.durationSeconds ?? 0));
      }
    });
    return out;
  }, [rows, meta]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto px-4 py-6 md:py-10">
        <header className="mb-4 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-gray-100">{title}</h2>
            <p className="text-sm text-gray-500">
              {songCount} {songCount === 1 ? 'song' : 'songs'}
              {totalSeconds > 0 && <> · {formatTotal(totalSeconds)} total</>}
            </p>
          </div>
          {aside}
        </header>
        <ol className="flex flex-col gap-1">
          {rows.map((row, i) =>
            row.type === 'heading' ? (
              <li
                key={`h-${i}`}
                className={`flex items-baseline gap-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400 ${i === 0 ? '' : 'pt-4'}`}
              >
                <span className="flex-1 min-w-0 truncate">{row.label}</span>
                {setSeconds.get(i) ? (
                  <span className="shrink-0 text-right tabular-nums normal-case tracking-normal">
                    {formatTotal(setSeconds.get(i)!)}
                  </span>
                ) : null}
              </li>
            ) : (
              <li key={`s-${i}`}>
                <button
                  onClick={() => onOpen(row.idx, row.song)}
                  className="w-full flex items-center gap-3 rounded px-3 py-2 min-h-11 text-left bg-gray-800/60 hover:bg-gray-700/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                >
                  <span className="text-xs text-gray-500 w-5 text-right shrink-0">{row.idx + 1}.</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-100">{row.song.title}</span>
                  <KeyBadge songKey={meta[row.song.id]?.key} />
                  <span className="text-xs text-gray-500 shrink-0 w-10 text-right tabular-nums">
                    {meta[row.song.id]?.durationSeconds ? formatTime(meta[row.song.id].durationSeconds) : ''}
                  </span>
                </button>
              </li>
            ),
          )}
        </ol>
      </div>
    </div>
  );
}

function KeyBadge({ songKey }: { songKey?: string }) {
  const k = songKey?.trim();
  if (!k) return <span className="shrink-0" style={{ minWidth: 36 }} aria-hidden="true" />;
  const cs = getCamelotStyle(k);
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs shrink-0 text-center ${cs ? '' : 'bg-gray-700 text-gray-400'}`}
      style={{ minWidth: 36, ...(cs ? { backgroundColor: cs.bg, color: cs.color } : {}) }}
    >
      {k}
    </span>
  );
}

/** A set's length: m:ss, or h:mm:ss once it passes an hour. */
function formatTotal(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h === 0) return formatTime(seconds);
  const rest = formatTime(seconds % 3600).padStart(5, '0');
  return `${h}:${rest}`;
}
