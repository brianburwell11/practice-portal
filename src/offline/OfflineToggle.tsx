import { useEffect } from 'react';
import { confirmDialog, toast } from '../store/dialogStore';
import { OFFLINE_CACHE_ENABLED } from './offline';
import { usePinStore } from './pinStore';
import { setlistPinId, songPinId } from './pin';
import type { SetlistConfig } from '../audio/types';
import type { Pin } from '../../sw/store';
import { useBandStore } from '../store/bandStore';
import { useSongStore } from '../store/songStore';

interface Props {
  /** The pin's id (`songPinId` / `setlistPinId`). */
  pinId: string;
  /** "song" or "setlist", for the labels. */
  what: 'song' | 'setlist';
  /** Its title or name, for the labels. */
  name: string;
  /** Start downloading it. */
  onPin: () => void;
  /** A pinned setlist that already keeps this song offline (its name). */
  coveredBy?: string;
  /** Icon only (the toolbar); otherwise icon and words. */
  compact?: boolean;
  /** Extra classes, such as a hover background. */
  className?: string;
}

/** The cloud's outline. */
const CLOUD = 'M17.5 19H7a5 5 0 1 1 1.6-9.74A6 6 0 0 1 20 11.5 3.75 3.75 0 0 1 17.5 19Z';

/**
 * "Available offline", like Drive's: on downloads everything the song or
 * setlist needs and keeps it on this device; off lets it go. In the band's
 * accent: an outline when it isn't kept, filled when it is. Shows progress
 * while downloading, and yellow when a download didn't finish.
 */
export function OfflineToggle({ pinId, what, name, onPin, coveredBy, compact = false, className = '' }: Props) {
  const load = usePinStore((s) => s.load);
  const pin = usePinStore((s) => s.pins[pinId]);
  const progress = usePinStore((s) => s.progress[pinId]);
  const error = usePinStore((s) => s.errors[pinId]);
  const unpin = usePinStore((s) => s.unpin);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (error) toast(error, 'error'); }, [error]);

  if (!OFFLINE_CACHE_ENABLED) return null;

  const downloading = !!progress;
  const ready = !!pin?.ready && !downloading;
  // Kept by a setlist, not by itself.
  const covered = !pin && !downloading && !!coveredBy;
  const filled = ready || covered;
  const partial = !!pin && !pin.ready && !downloading;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const label = downloading
    ? `Downloading ${what === 'song' ? 'this song' : 'this setlist'}: ${pct}%`
    : ready
      ? 'Available offline'
      : covered
        ? `Available offline with “${coveredBy}”`
        : partial
          ? 'Not fully downloaded. Click to try again'
          : 'Make available offline';

  const onClick = async () => {
    if (downloading) return;
    if (covered) {
      toast(`Kept offline with the “${coveredBy}” setlist. To stop, turn it off on that setlist.`);
      return;
    }
    if (pin?.ready) {
      if (!(await confirmDialog({
        title: `Stop keeping “${name}” offline?`,
        message: 'It stays on this device until space is needed, but won’t be kept for sure.',
        confirmLabel: 'Stop keeping offline',
      }))) return;
      await unpin(pinId);
      return;
    }
    onPin();
  };

  return (
    <button
      onClick={onClick}
      aria-pressed={filled}
      aria-label={label}
      title={label}
      data-help={what === 'song' ? 'Make this song available offline' : 'Make this setlist available offline'}
      className={`inline-flex items-center gap-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 ${
        compact ? 'p-1.5 min-h-[44px] min-w-[44px] justify-center md:min-h-0 md:min-w-0' : 'px-2 py-1'
      } ${partial ? 'text-yellow-400' : 'text-blue-400'} ${className}`}
    >
      {downloading ? (
        <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      ) : filled ? (
        // Filled cloud, the check cut out in the page's background.
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={CLOUD} />
          <polyline points="9 14 11.5 16.5 15.5 12" fill="none" style={{ stroke: 'var(--color-gray-950)' }} />
        </svg>
      ) : (
        // Outline cloud with a down arrow.
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={CLOUD} />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <polyline points="9.5 14 12 16.5 14.5 14" />
        </svg>
      )}
      {!compact && (
        <span>{downloading ? `Downloading ${pct}%` : ready ? 'Available offline' : partial ? 'Try again' : 'Make available offline'}</span>
      )}
    </button>
  );
}

/** The pinned setlist (ready) that keeps this song offline, if any. */
function coveringSetlist(pins: Record<string, Pin>, band: string, songId: string): Pin | undefined {
  return Object.values(pins).find((p) => p.kind === 'setlist' && p.band === band && p.ready
    && (p.songIds?.includes(songId) ?? p.songs.includes(`${band}/${songId}`)));
}

/** The toolbar's toggle for the song that's open. */
export function CurrentSongOfflineToggle() {
  const band = useBandStore((s) => s.currentBand?.id);
  const selectedSong = useSongStore((s) => s.selectedSong);
  const entry = useSongStore((s) => s.manifest?.songs.find((x) => x.id === s.selectedSong?.id));
  const pinSong = usePinStore((s) => s.pinSong);
  const coveredBy = usePinStore((s) => (band && entry ? coveringSetlist(s.pins, band, entry.id)?.label : undefined));
  if (!band || !selectedSong || !entry) return null;
  return (
    <OfflineToggle
      compact
      pinId={songPinId(band, entry.id)}
      what="song"
      name={entry.title}
      coveredBy={coveredBy}
      onPin={() => void pinSong(band, entry)}
    />
  );
}

/** The setlist page's toggle for the whole setlist. */
export function SetlistOfflineToggle({ setlist }: { setlist: SetlistConfig }) {
  const band = useBandStore((s) => s.currentBand?.id);
  const pinSetlist = usePinStore((s) => s.pinSetlist);
  if (!band) return null;
  return (
    <OfflineToggle
      compact
      className="hover:bg-gray-700/70"
      pinId={setlistPinId(band, setlist.id)}
      what="setlist"
      name={setlist.name}
      onPin={() => void pinSetlist(band, setlist)}
    />
  );
}
