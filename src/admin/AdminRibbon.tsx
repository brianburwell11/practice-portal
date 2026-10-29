import { useState, useRef, useEffect } from 'react';
import { HelpModal } from '../components/HelpModal';
import { useBandStore } from '../store/bandStore';
import { useSessionStore } from '../store/sessionStore';
import { safeHref } from '../utils/url';

type DropdownId = 'bands' | 'songs' | 'setlists' | null;

interface Props {
  setlistNavLinks?: { title: string; url: string }[];
  songNavLinks?: { title: string; url: string }[];
  hasBand?: boolean;
  hasSong?: boolean;
  hasSetlist?: boolean;
  onManageMembers?: () => void;
  onEditBand?: () => void;
  onDeleteBand?: () => void;
  onAddSong?: () => void;
  onEditSong?: () => void;
  onTapMapEditor?: () => void;
  onLyricsEditor?: () => void;
  onDeleteSong?: () => void;
  onAddSetlist?: () => void;
  onEditSetlist?: () => void;
  onCopySetlist?: () => void;
  onDeleteSetlist?: () => void;
  onViewAllSetlists?: () => void;
  /** Copy the band's guest link, opening on the current setlist. */
  onCopyGuestLink?: () => void;
}

interface MenuEntry {
  label: string;
  /** You hold the capability. */
  show: boolean;
  /** Something is selected for it to act on. */
  enabled: boolean;
  danger?: boolean;
  onClick?: () => void;
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
      role="menuitem"
      onClick={enabled ? onClick : undefined}
      aria-disabled={!enabled}
      className={`block w-full text-left px-4 py-2.5 md:py-1.5 text-sm md:text-xs whitespace-nowrap ${
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
  hasBand,
  hasSong,
  hasSetlist,
  onManageMembers,
  onEditBand,
  onDeleteBand,
  onAddSong,
  onEditSong,
  onTapMapEditor,
  onLyricsEditor,
  onDeleteSong,
  onAddSetlist,
  onEditSetlist,
  onCopySetlist,
  onDeleteSetlist,
  onViewAllSetlists,
  onCopyGuestLink,
}: Props) {
  const [open, setOpen] = useState<DropdownId>(null);
  const [showHelp, setShowHelp] = useState(false);
  const ribbonRef = useRef<HTMLDivElement>(null);

  // A press anywhere else (mouse, touch or pen) or Escape closes the open menu.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: PointerEvent) {
      if (ribbonRef.current && !ribbonRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(null);
    }
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const toggle = (id: DropdownId) => setOpen((prev) => (prev === id ? null : id));

  const close = () => setOpen(null);

  // What you can do here, from the session. Hiding a control is UX only —
  // the server checks every request on its own.
  const bandId = useBandStore((st) => st.currentBand?.id);
  const caps = useSessionStore((st) => st.capabilitiesIn(bandId));
  const can = (c: string) => !!caps?.includes(c);

  const allMenus: { id: Exclude<DropdownId, null>; label: string; items: MenuEntry[] }[] = [
    {
      id: 'bands',
      label: 'Band',
      items: [
        { label: 'Edit Band', show: can('band.settings'), enabled: !!hasBand, onClick: onEditBand },
        { label: 'Members & Sharing', show: can('member.invite'), enabled: !!hasBand, onClick: onManageMembers },
        { label: 'Delete Band', show: can('band.delete'), enabled: !!hasBand, danger: true, onClick: onDeleteBand },
      ],
    },
    {
      id: 'songs',
      label: 'Songs',
      items: [
        { label: 'Add Song', show: can('song.create'), enabled: true, onClick: onAddSong },
        { label: 'Edit Song', show: can('song.content.write'), enabled: !!hasSong, onClick: onEditSong },
        { label: 'TapMap Editor', show: can('song.timing.write'), enabled: !!hasSong, onClick: onTapMapEditor },
        { label: 'Lyrics Editor', show: can('song.content.write'), enabled: !!hasSong, onClick: onLyricsEditor },
        { label: 'Delete Song', show: can('song.delete'), enabled: !!hasSong, danger: true, onClick: onDeleteSong },
      ],
    },
    {
      id: 'setlists',
      label: 'Setlists',
      items: [
        { label: 'Add Setlist', show: can('setlist.write'), enabled: true, onClick: onAddSetlist },
        { label: 'Edit Setlist', show: can('setlist.write'), enabled: !!hasSetlist, onClick: onEditSetlist },
        { label: 'Copy Setlist', show: can('setlist.write'), enabled: !!hasSetlist, onClick: onCopySetlist },
        { label: 'Delete Setlist', show: can('setlist.write'), enabled: !!hasSetlist, danger: true, onClick: onDeleteSetlist },
        { label: 'View All Setlists', show: can('setlist.write'), enabled: true, onClick: onViewAllSetlists },
        { label: 'Copy Guest Link', show: can('member.invite'), enabled: !!hasSetlist, onClick: onCopyGuestLink },
      ],
    },
  ];
  // Controls you can't use are hidden, not greyed out; a menu with nothing in it goes too.
  const menus = allMenus
    .map((m) => ({ ...m, items: m.items.filter((i) => i.show) }))
    .filter((m) => m.items.length > 0);

  return (
    <div
      ref={ribbonRef}
      className="px-4 py-1.5 border-b flex items-center gap-3 min-h-[33px]"
      style={{ borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)' }}
    >
      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            onClick={() => toggle(menu.id)}
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            className="py-1.5 text-sm md:text-xs text-gray-400 md:text-gray-500 hover:text-gray-300"
          >
            {menu.label} <span className="text-base">▾</span>
          </button>
          {open === menu.id && (
            <div role="menu" aria-label={menu.label} className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
              {menu.items.map((item) => (
                <MenuItem
                  key={item.label}
                  label={item.label}
                  enabled={item.enabled}
                  danger={item.danger}
                  onClick={() => { close(); item.onClick?.(); }}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {menus.length > 0
        && ((setlistNavLinks && setlistNavLinks.length > 0) || (songNavLinks && songNavLinks.length > 0)) && (
        <div className="border-l border-gray-700 h-4" />
      )}

      {setlistNavLinks?.map((link, i) => (
        <a
          key={`sl-${i}`}
          href={safeHref(link.url)}
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
          href={safeHref(link.url)}
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
        aria-label="Help"
      >
        ?
      </button>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
