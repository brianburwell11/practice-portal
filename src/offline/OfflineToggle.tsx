import { useEffect } from 'react';
import { confirmDialog, toast } from '../store/dialogStore';
import { OFFLINE_CACHE_ENABLED } from './offline';
import { usePinStore } from './pinStore';
import { setlistPinId, songPinId } from './pin';
import type { SetlistConfig } from '../audio/types';
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
  /** Icon only (the toolbar); otherwise icon and words. */
  compact?: boolean;
}

/**
 * "Available offline", like Drive's: on downloads everything the song or
 * setlist needs and keeps it on this device; off lets it go. Shows progress
 * while downloading, and a check once it's all there.
 */
export function OfflineToggle({ pinId, what, name, onPin, compact = false }: Props) {
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
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const label = downloading
    ? `Downloading ${what === 'song' ? 'this song' : 'this setlist'}: ${pct}%`
    : ready
      ? 'Available offline'
      : pin
        ? 'Not fully downloaded. Click to try again'
        : 'Make available offline';

  const onClick = async () => {
    if (downloading) return;
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
      aria-pressed={!!pin}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded text-xs font-medium transition-colors ${
        compact ? 'p-1.5 min-h-[44px] md:min-h-0' : 'px-2 py-1'
      } ${ready ? 'text-green-400 hover:text-green-300' : pin ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {downloading ? (
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      ) : ready ? (
        // Cloud with a check
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H7a5 5 0 1 1 1.6-9.74A6 6 0 0 1 20 11.5 3.75 3.75 0 0 1 17.5 19Z" />
          <polyline points="9 14 11.5 16.5 15.5 12" />
        </svg>
      ) : (
        // Cloud with a down arrow
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H7a5 5 0 1 1 1.6-9.74A6 6 0 0 1 20 11.5 3.75 3.75 0 0 1 17.5 19Z" />
          <line x1="12" y1="11" x2="12" y2="16.5" />
          <polyline points="9.5 14 12 16.5 14.5 14" />
        </svg>
      )}
      {!compact && (
        <span>{downloading ? `Downloading ${pct}%` : ready ? 'Available offline' : pin ? 'Try again' : 'Make available offline'}</span>
      )}
    </button>
  );
}

/** The toolbar's toggle for the song that's open. */
export function CurrentSongOfflineToggle() {
  const band = useBandStore((s) => s.currentBand?.id);
  const selectedSong = useSongStore((s) => s.selectedSong);
  const entry = useSongStore((s) => s.manifest?.songs.find((x) => x.id === s.selectedSong?.id));
  const pinSong = usePinStore((s) => s.pinSong);
  if (!band || !selectedSong || !entry) return null;
  return (
    <OfflineToggle
      compact
      pinId={songPinId(band, entry.id)}
      what="song"
      name={entry.title}
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
      pinId={setlistPinId(band, setlist.id)}
      what="setlist"
      name={setlist.name}
      onPin={() => void pinSetlist(band, setlist)}
    />
  );
}
