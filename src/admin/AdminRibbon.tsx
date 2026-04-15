import { useState, useRef, useEffect } from 'react';
import { HelpModal } from '../components/HelpModal';

type DropdownId = 'songs' | 'setlists' | null;

interface Props {
  setlistNavLinks?: { title: string; url: string }[];
  songNavLinks?: { title: string; url: string }[];
  hasSong?: boolean;
  hasSetlist?: boolean;
  onAddSong?: () => void;
  onEditSong?: () => void;
  onTapMapEditor?: () => void;
  onLyricsEditor?: () => void;
  onDeleteSong?: () => void;
  onAddSetlist?: () => void;
  onEditSetlist?: () => void;
  onCopySetlist?: () => void;
  onDeleteSetlist?: () => void;
}

function MenuItem({
  label,
  enabled,
  danger,
  onClick,
}: {
  label: string;
  enabled: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={enabled ? onClick : undefined}
      className={`block w-full text-left px-3 py-1.5 text-xs whitespace-nowrap ${
        enabled
          ? danger
            ? 'text-gray-400 hover:text-red-400 hover:bg-gray-700/50'
            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
          : 'text-gray-600 cursor-default'
      }`}
    >
      {label}
    </button>
  );
}

export function AdminRibbon({
  setlistNavLinks,
  songNavLinks,
  hasSong,
  hasSetlist,
  onAddSong,
  onEditSong,
  onTapMapEditor,
  onLyricsEditor,
  onDeleteSong,
  onAddSetlist,
  onEditSetlist,
  onCopySetlist,
  onDeleteSetlist,
}: Props) {
  const [open, setOpen] = useState<DropdownId>(null);
  const [showHelp, setShowHelp] = useState(false);
  const ribbonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ribbonRef.current && !ribbonRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = (id: DropdownId) => setOpen((prev) => (prev === id ? null : id));

  const close = () => setOpen(null);

  return (
    <div
      ref={ribbonRef}
      className="px-4 py-1.5 border-b flex items-center gap-3 min-h-[33px]"
      style={{ borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)' }}
    >
      {import.meta.env.DEV && (
        <>
          {/* Songs dropdown */}
          <div className="relative">
            <button
              onClick={() => toggle('songs')}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Songs <span className="text-base">▾</span>
            </button>
            {open === 'songs' && (
              <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
                <MenuItem label="Add Song" enabled onClick={() => { close(); onAddSong?.(); }} />
                <MenuItem label="Edit Song" enabled={!!hasSong} onClick={() => { close(); onEditSong?.(); }} />
                <MenuItem label="TapMap Editor" enabled={!!hasSong} onClick={() => { close(); onTapMapEditor?.(); }} />
                <MenuItem label="Lyrics Editor" enabled={!!hasSong} onClick={() => { close(); onLyricsEditor?.(); }} />
                <MenuItem label="Delete Song" enabled={!!hasSong} danger onClick={() => { close(); onDeleteSong?.(); }} />
              </div>
            )}
          </div>

          {/* Setlists dropdown */}
          <div className="relative">
            <button
              onClick={() => toggle('setlists')}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Setlists <span className="text-base">▾</span>
            </button>
            {open === 'setlists' && (
              <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
                <MenuItem label="Add Setlist" enabled onClick={() => { close(); onAddSetlist?.(); }} />
                <MenuItem label="Edit Setlist" enabled={!!hasSetlist} onClick={() => { close(); onEditSetlist?.(); }} />
                <MenuItem label="Copy Setlist" enabled={!!hasSetlist} onClick={() => { close(); onCopySetlist?.(); }} />
                <MenuItem label="Delete Setlist" enabled={!!hasSetlist} danger onClick={() => { close(); onDeleteSetlist?.(); }} />
              </div>
            )}
          </div>

          {((setlistNavLinks && setlistNavLinks.length > 0) || (songNavLinks && songNavLinks.length > 0)) && (
            <div className="border-l border-gray-700 h-4" />
          )}
        </>
      )}

      {setlistNavLinks?.map((link, i) => (
        <a
          key={`sl-${i}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          {link.title}
        </a>
      ))}

      {setlistNavLinks && setlistNavLinks.length > 0 && songNavLinks && songNavLinks.length > 0 && (
        <div className="border-l border-gray-700 h-4" />
      )}

      {songNavLinks?.map((link, i) => (
        <a
          key={`sg-${i}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          {link.title}
        </a>
      ))}

      <button
        onClick={() => setShowHelp(true)}
        className="ml-auto w-5 h-5 rounded-full border border-gray-600 text-gray-500 hover:text-gray-300 hover:border-gray-400 flex items-center justify-center text-xs leading-none transition-colors"
        title="Help"
      >
        ?
      </button>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
