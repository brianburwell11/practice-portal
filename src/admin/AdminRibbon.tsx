import { useState, useRef, useEffect, type CSSProperties } from 'react';
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
  onChordsEditor?: () => void;
  onDeleteSong?: () => void;
  onAddSetlist?: () => void;
  onEditSetlist?: () => void;
  onCopySetlist?: () => void;
  onDeleteSetlist?: () => void;
  onViewAllSetlists?: () => void;
  /** Copy the band's guest link, opening on the current setlist. */
  onCopyGuestLink?: () => void;
  /** `ribbon`: the row of menus under the header (desktop). `menu`: a ☰
   *  button for the header that opens everything in one sheet (phones). */
  variant?: 'ribbon' | 'menu';
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

/** A ribbon button or link: a small pill that lights up on hover. */
const CHIP = 'h-5 px-2 rounded-full inline-flex items-center gap-1 text-xs hover:bg-on-accent/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-on-accent transition-colors';

/** Divider between the ribbon's groups. */
function Dot() {
  return <span aria-hidden="true" className="mx-1 w-1 h-1 rounded-full bg-gray-600" />;
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
  onChordsEditor,
  onDeleteSong,
  onAddSetlist,
  onEditSetlist,
  onCopySetlist,
  onDeleteSetlist,
  onViewAllSetlists,
  onCopyGuestLink,
  variant = 'ribbon',
}: Props) {
  const [open, setOpen] = useState<DropdownId>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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
        { label: 'Chords Editor', show: can('song.content.write'), enabled: !!hasSong, onClick: onChordsEditor },
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

  if (variant === 'menu') {
    const links = [
      ...(setlistNavLinks ?? []).map((l) => ({ ...l, key: `sl-${l.url}` })),
      ...(songNavLinks ?? []).map((l) => ({ ...l, key: `sg-${l.url}` })),
    ];
    const row = 'block w-full text-left px-4 py-3 text-base';
    return (
      <>
        <button
          onClick={() => setSheetOpen(true)}
          className="w-10 h-10 -my-1 flex items-center justify-center rounded-lg text-gray-300 hover:bg-gray-700/50"
          aria-label="Menu"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        {sheetOpen && (
          <div className="theme-default fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setSheetOpen(false)}>
            <div
              role="dialog"
              aria-label="Menu"
              className="w-full max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-gray-900 border-t border-gray-700 pb-[max(1rem,env(safe-area-inset-bottom))]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
                <div className="h-1 w-10 rounded-full bg-gray-700" />
              </div>
              {menus.map((menu) => (
                <div key={menu.id} className="py-1">
                  <div className="px-4 pt-2 pb-1 text-xs uppercase tracking-wide text-gray-500">{menu.label}</div>
                  {menu.items.map((item) => (
                    <button
                      key={item.label}
                      onClick={item.enabled ? () => { setSheetOpen(false); item.onClick?.(); } : undefined}
                      aria-disabled={!item.enabled}
                      className={`${row} ${
                        item.enabled
                          ? item.danger ? 'text-red-300 active:bg-gray-800' : 'text-gray-200 active:bg-gray-800'
                          : 'text-gray-600'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ))}
              {links.length > 0 && (
                <div className="py-1 border-t border-gray-800">
                  <div className="px-4 pt-2 pb-1 text-xs uppercase tracking-wide text-gray-500">Links</div>
                  {links.map((link) => (
                    <a
                      key={link.key}
                      href={safeHref(link.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${row} text-gray-200 active:bg-gray-800`}
                    >
                      {link.title}
                    </a>
                  ))}
                </div>
              )}
              <div className="py-1 border-t border-gray-800">
                <button
                  onClick={() => { setSheetOpen(false); setShowHelp(true); }}
                  className={`${row} text-gray-200 active:bg-gray-800`}
                >
                  Help
                </button>
              </div>
            </div>
          </div>
        )}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </>
    );
  }

  return (
    <>
    {/* Filled with the band's accent, deeper on the left. Its grays are
        redefined from the text color that reads on the accent, so labels,
        links and dividers stay legible on any accent; the open menus reset
        them (`theme-default`). */}
    <div
      ref={ribbonRef}
      className="relative px-3 h-7 flex items-center gap-1"
      style={{
        '--color-gray-300': 'var(--color-on-accent)',
        '--color-gray-400': 'var(--color-on-accent)',
        '--color-gray-500': 'var(--color-on-accent)',
        '--color-gray-600': 'color-mix(in srgb, var(--color-on-accent) 50%, var(--color-blue-500))',
        '--color-gray-700': 'color-mix(in srgb, var(--color-on-accent) 40%, var(--color-blue-500))',
        color: 'var(--color-on-accent)',
        backgroundColor: 'var(--color-blue-500)',
        backgroundImage: 'linear-gradient(90deg, var(--color-accent-deep), var(--color-blue-500) 60%)',
        boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--color-on-accent) 22%, transparent), inset 0 -1px 0 rgb(0 0 0 / 0.18)',
      } as CSSProperties}
    >
      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            onClick={() => toggle(menu.id)}
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            className={`${CHIP} font-medium tracking-wide ${open === menu.id ? 'bg-on-accent/20' : ''}`}
          >
            {menu.label}
            <svg viewBox="0 0 10 6" aria-hidden="true" className={`w-2 h-1.5 transition-transform ${open === menu.id ? 'rotate-180' : ''}`}>
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open === menu.id && (
            <div role="menu" aria-label={menu.label} className="theme-default absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg py-1 z-50">
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
        <Dot />
      )}

      {setlistNavLinks?.map((link, i) => (
        <a
          key={`sl-${i}`}
          href={safeHref(link.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={CHIP}
        >
          {link.title}
          <span aria-hidden="true" className="text-[10px] opacity-70">↗</span>
        </a>
      ))}

      {setlistNavLinks && setlistNavLinks.length > 0 && songNavLinks && songNavLinks.length > 0 && (
        <Dot />
      )}

      {songNavLinks?.map((link, i) => (
        <a
          key={`sg-${i}`}
          href={safeHref(link.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={CHIP}
        >
          {link.title}
          <span aria-hidden="true" className="text-[10px] opacity-70">↗</span>
        </a>
      ))}

      <button
        onClick={() => setShowHelp(true)}
        className="ml-auto w-5 h-5 rounded-full bg-on-accent/15 hover:bg-on-accent/30 flex items-center justify-center text-[11px] font-semibold leading-none transition-colors"
        title="Help"
        aria-label="Help"
      >
        ?
      </button>
    </div>
    {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </>
  );
}
