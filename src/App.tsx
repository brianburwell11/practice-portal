import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';
import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList, SetlistDropdown, SetlistNav } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { LyricsDisplay } from './components/LyricsDisplay';
import { NotesLayer } from './components/notes/NotesLayer';
import { ChordLane } from './components/chords/ChordLane';
import { UndoToast } from './components/notes/UndoToast';
import { useNotesKeyboard } from './hooks/useNotesKeyboard';
import { ScrollingScore } from './components/sheet/ScrollingScore';
import { MixerPanel } from './components/mixer/MixerPanel';
import { NoSongState } from './components/song-select/NoSongState';
import { MinimizedRibbon } from './components/MinimizedRibbon';
import { YouTubeMiniPlayerStack } from './components/youtube/YouTubeMiniPlayerStack';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { LyricsEditorModal } from './components/lyrics-editor/LyricsEditorModal';
import { ChordsEditorModal } from './components/chords-editor/ChordsEditorModal';
import { DeleteSongModal } from './components/song-select/DeleteSongModal';
import { AdminRibbon } from './admin/AdminRibbon';
import { AccountMenu } from './components/account/AccountMenu';
import { MembersModal } from './components/account/MembersModal';
import { HomeScreenOffer } from './components/HomeScreen';
import { useSessionStore } from './store/sessionStore';
import { confirmDiscard, toast } from './store/dialogStore';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useLyricsEditorStore } from './store/lyricsEditorStore';
import { usePanelMinimizeStore } from './store/panelMinimizeStore';
import { useLyricsStore } from './store/lyricsStore';
import { useChordsStore } from './store/chordsStore';
import { useChordsEditorStore } from './store/chordsEditorStore';
import { dataUrl, safeHref } from './utils/url';
import { chordsDataSchema } from './config/schema';
import { phonePanelOpen, rememberPhonePanel } from './utils/phonePanels';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { bandTheme } from './utils/bandTheme';
import { useSetlistStore } from './store/setlistStore';
import { Link, useNavigate } from 'react-router-dom';
import practicePortalLogo from './assets/practice-portal-logo.png';
import { useMixerPersistence } from './hooks/useMixerPersistence';
import { useMediaQuery } from './hooks/useMediaQuery';


const SetlistModal = lazy(() => import('./admin/SetlistModal').then((m) => ({ default: m.SetlistModal })));
const DeleteSetlistModal = lazy(() => import('./admin/DeleteSetlistModal').then((m) => ({ default: m.DeleteSetlistModal })));
const ViewAllSetlistsModal = lazy(() => import('./admin/ViewAllSetlistsModal').then((m) => ({ default: m.ViewAllSetlistsModal })));
const EditBandModal = lazy(() => import('./admin/EditBandModal').then((m) => ({ default: m.EditBandModal })));
const DeleteBandModal = lazy(() => import('./admin/DeleteBandModal').then((m) => ({ default: m.DeleteBandModal })));

/** Capabilities that come with something to manage — beyond reading and playing. */
const ADMIN_CAPABILITIES = new Set([
  'band.settings', 'band.delete', 'member.invite', 'song.create', 'song.content.write',
  'song.timing.write', 'song.audio.write', 'song.score.write', 'song.delete', 'setlist.write',
]);

const LYRICS_UNSAVED = 'You have unsaved lyrics changes.';
const TAPMAP_UNSAVED = 'You have unsaved tapMap changes.';
const CHORDS_UNSAVED = 'You have unsaved chord changes.';

/**
 * Copy the band's guest link, opening on `setlistSlug`. The link is the band's
 * one "anyone with the link" link, so this only works once it's turned on.
 */
async function copyGuestLink(bandId: string, setlistSlug: string): Promise<void> {
  try {
    const res = await fetch(`/api/bands/${encodeURIComponent(bandId)}/guest-link`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    if (!data.link) {
      toast('The guest link is off. Turn it on in Band → Members & Sharing first.');
      return;
    }
    // The link already carries `?guest=`.
    await navigator.clipboard.writeText(`${data.link.url}&setlist=${encodeURIComponent(setlistSlug)}`);
    toast(data.link.expired
      ? 'Copied, but the guest link has expired. Change its expiry in Members & Sharing.'
      : 'Guest link to this setlist copied. Anyone with it can play the band’s songs.');
  } catch (err) {
    toast(`Couldn’t copy the guest link: ${(err as Error).message}`, 'error');
  }
}

export default function App() {
  const engine = useCreateEngine();
  useMixerPersistence();
  useNotesKeyboard();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);
  const closeMarkerEditor = useMarkerEditorStore((s) => s.close);
  const markerEditorOpen = useMarkerEditorStore((s) => s.isOpen);
  const markerEditorDirty = useMarkerEditorStore((s) => s.dirty);
  const openLyricsEditor = useLyricsEditorStore((s) => s.open);
  const closeLyricsEditor = useLyricsEditorStore((s) => s.close);
  const lyricsEditorOpen = useLyricsEditorStore((s) => s.isOpen);
  const editorLines = useLyricsEditorStore((s) => s.lines);
  const lyricsEditorMode = useLyricsEditorStore((s) => s.mode);
  const openChordsEditor = useChordsEditorStore((s) => s.open);
  const chordsEditorOpen = useChordsEditorStore((s) => s.isOpen);
  const editorChords = useChordsEditorStore((s) => s.chords);
  // The on-page editors hide the pickers, the ribbon and most transport
  // buttons so a stray tap can't switch songs mid-session.
  const editorFocus = markerEditorOpen || lyricsEditorOpen || chordsEditorOpen;

  /** Close whichever on-page editor is open (except `keep`), asking first if
   *  it has unsaved changes. False if the user chose to stay. */
  const closeOtherEditors = async (keep?: 'tapmap' | 'lyrics' | 'chords'): Promise<boolean> => {
    if (keep !== 'lyrics' && lyricsEditorOpen) {
      if (useLyricsEditorStore.getState().dirty && !(await confirmDiscard(LYRICS_UNSAVED))) return false;
      closeLyricsEditor();
    }
    if (keep !== 'tapmap' && markerEditorOpen) {
      if (markerEditorDirty && !(await confirmDiscard(TAPMAP_UNSAVED))) return false;
      closeMarkerEditor();
    }
    if (keep !== 'chords' && chordsEditorOpen) {
      if (useChordsEditorStore.getState().dirty && !(await confirmDiscard(CHORDS_UNSAVED))) return false;
      useChordsEditorStore.getState().close();
    }
    return true;
  };
  // Phones and desktop lay the header out differently (one picker each,
  // so their effects don't run twice).
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const currentBand = useBandStore((s) => s.currentBand);
  // The band's background (or the editor's unsaved preview), turned into a
  // text color, gray scale and accent fixes that keep every label readable.
  const previewColors = useBandStore((s) => s.previewColors);
  const themeBg = (previewColors ?? currentBand?.colors)?.background;
  const theme = useMemo(() => (themeBg ? bandTheme({ background: themeBg }) : null), [themeBg]);
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSetlistModal, setShowSetlistModal] = useState(false);
  const [editSetlistId, setEditSetlistId] = useState<string | undefined>(undefined);
  const [copySetlistId, setCopySetlistId] = useState<string | undefined>(undefined);
  const [showDeleteSetlistModal, setShowDeleteSetlistModal] = useState(false);
  const [showViewAllSetlistsModal, setShowViewAllSetlistsModal] = useState(false);
  const [showEditBandModal, setShowEditBandModal] = useState(false);
  /** Phones with no editor open scroll the whole page; editors keep the
   *  fixed layout they fill and scroll inside. */
  const phonePageScroll = !isDesktop && !editorFocus && !showEditBandModal;
  // The header's height (it wraps on narrow phones), so the waveform can pin
  // right under it while the page scrolls.
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [showMembersModal, setShowMembersModal] = useState(false);
  // Anything to manage here? Decides whether a Member sees the admin ribbon
  // at all (they don't — their screen is the public one). UX only.
  const myCaps = useSessionStore((s) => s.capabilitiesIn(currentBand?.id));
  const signedIn = useSessionStore((s) => !!s.user);
  const canManage = !!myCaps?.some((c) => ADMIN_CAPABILITIES.has(c));
  const canEditContent = !!myCaps?.includes('song.content.write');
  const canInvite = !!myCaps?.includes('member.invite');

  // An access-request email links here with ?requests=1: Members & Sharing
  // opens once the session says you may, and the address is tidied.
  const [fromRequestsLink, setFromRequestsLink] = useState(() => new URLSearchParams(window.location.search).has('requests'));
  const membersOpen = showMembersModal || (fromRequestsLink && canInvite);
  useEffect(() => {
    if (!fromRequestsLink || !canInvite) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('requests');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, [fromRequestsLink, canInvite]);
  const [showDeleteBandModal, setShowDeleteBandModal] = useState(false);
  // Mobile-only toggle: shows the master volume/speed sliders + mixer panel below the lyrics.
  // Open unless this device turned it off.
  const [mobileControlsOpen, setMobileControlsOpen] = useState(() => phonePanelOpen('mixer'));
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const sheetMinimized = usePanelMinimizeStore((s) =>
    s.items.some((x) => x.kind === 'panel' && x.id === 'sheet'),
  );
  const lyricsLoaded = useLyricsStore((s) => s.loaded);
  const lyricsLineCount = useLyricsStore((s) => s.lines.length);
  const chordsLoaded = useChordsStore((s) => s.loaded);
  const chordCount = useChordsStore((s) => s.chords.length);

  // When the loaded song changes: scope per-song video minimize memory
  // (saved video chips for this song are restored from localStorage; the
  // previous song's video chips are dropped). Sheet music chip is pruned
  // synchronously when the new song has no `sheetMusicUrl`. Mixer and
  // lyrics chips persist by default — lyrics is pruned in a separate
  // effect once the lyrics store finishes loading (it loads async).
  useEffect(() => {
    const store = usePanelMinimizeStore.getState();
    store.setCurrentSongId(selectedSong?.id ?? null);
    if (!selectedSong?.sheetMusicUrl) store.restorePanel('sheet');
  }, [selectedSong?.id, selectedSong?.sheetMusicUrl]);

  // Prune the lyrics chip when the new song has no lyrics. Gated on
  // `loaded` so we don't false-fire during the brief empty window
  // between `clear()` and the fetch settling.
  useEffect(() => {
    if (lyricsLoaded && lyricsLineCount === 0) {
      usePanelMinimizeStore.getState().restorePanel('lyrics');
    }
  }, [lyricsLoaded, lyricsLineCount]);

  // Same for the chords chip.
  useEffect(() => {
    if (chordsLoaded && chordCount === 0) {
      usePanelMinimizeStore.getState().restorePanel('chords');
    }
  }, [chordsLoaded, chordCount]);

  const bandRoute = currentBand?.route ?? '';

  // The admin actions, shown as the ribbon on desktop and the ☰ menu on phones.
  const showAdmin = !editorFocus && !!(canManage || activeSetlist?.navLinks?.length || selectedSong?.navLinks?.length);
  const adminProps = {
    setlistNavLinks: activeSetlist?.navLinks,
    songNavLinks: selectedSong?.navLinks,
    hasBand: !!currentBand,
    hasSong: !!selectedSong,
    hasSetlist: !!activeSetlist,
    onManageMembers: () => setShowMembersModal(true),
    onEditBand: async () => {
      if (!(await closeOtherEditors())) return;
      setShowEditBandModal(true);
    },
    onDeleteBand: () => setShowDeleteBandModal(true),
    onAddSong: () => navigate(`/${bandRoute}/admin/add-song`),
    onEditSong: () => selectedSong && navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`),
    onTapMapEditor: async () => {
      if (!selectedSong) return;
      if (!(await closeOtherEditors('tapmap'))) return;
      openMarkerEditor(selectedSong.tapMap ?? []);
    },
    onChordsEditor: async () => {
      if (!selectedSong || !currentBand) return;
      if (!(await closeOtherEditors('chords'))) return;
      setShowEditBandModal(false);
      // The saved chords, not the store's: the store may lag a save made elsewhere.
      fetch(dataUrl(`${currentBand.id}/songs/${selectedSong.id}/chords.json`))
        .then((r) => (r.ok ? r.json() : { chords: [] }))
        .then((data) => {
          const parsed = chordsDataSchema.safeParse(data);
          openChordsEditor(parsed.success ? parsed.data.chords : []);
        })
        .catch(() => openChordsEditor([]));
    },
    onLyricsEditor: async () => {
      if (!selectedSong || !currentBand) return;
      if (!(await closeOtherEditors('lyrics'))) return;
      setShowEditBandModal(false);
      fetch(dataUrl(`${currentBand.id}/songs/${selectedSong.id}/lyrics.json`))
        .then((r) => (r.ok ? r.json() : { lines: [] }))
        .then((data) => openLyricsEditor(data.lines ?? []))
        .catch(() => openLyricsEditor([]));
    },
    onDeleteSong: () => setShowDeleteModal(true),
    onAddSetlist: () => { setEditSetlistId(undefined); setCopySetlistId(undefined); setShowSetlistModal(true); },
    onEditSetlist: () => { if (activeSetlist) { setEditSetlistId(activeSetlist.id); setCopySetlistId(undefined); setShowSetlistModal(true); } },
    onCopySetlist: () => { if (activeSetlist) { setEditSetlistId(undefined); setCopySetlistId(activeSetlist.id); setShowSetlistModal(true); } },
    onDeleteSetlist: () => setShowDeleteSetlistModal(true),
    onViewAllSetlists: () => setShowViewAllSetlistsModal(true),
    onCopyGuestLink: () => { if (currentBand && activeSetlist) copyGuestLink(currentBand.id, activeSetlist.slug ?? activeSetlist.id); },
  };

  return (
    <AudioEngineContext.Provider value={engine}>
      <div
        className={`h-screen flex flex-col ${phonePageScroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
        style={{
          ...(theme?.vars as CSSProperties | undefined),
          backgroundColor: 'var(--band-bg, var(--color-page))',
          color: theme ? theme.ink : '#f3f4f6',
        }}
      >
        {/* Header */}
        <header
          ref={headerRef}
          className={`px-3 py-2 md:px-4 md:py-3 border-b border-gray-700 flex flex-wrap items-center gap-y-1.5 md:relative ${
            phonePageScroll ? 'sticky top-0 z-30' : ''
          }`}
          style={{
            borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)',
            ...(phonePageScroll ? { backgroundColor: 'var(--band-bg, var(--color-page))' } : {}),
          }}
        >
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            {/* Practice Portal's own mark: back to the band picker. */}
            <Link
              to="/"
              title="Practice Portal home"
              className="inline-block shrink-0 origin-left transition-transform hover:scale-105"
            >
              {/* A soft shadow lifts the mark off any band's colours. */}
              <img
                src={practicePortalLogo}
                alt="Practice Portal home"
                className="h-8 md:h-10 w-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
              />
            </Link>
            {(() => {
              // The page's one H1: the band's logo (its alt text is the name) or its name.
              const name = currentBand?.logo ? (
                <img
                  src={currentBand.logo}
                  alt={currentBand.name}
                  className="h-8 md:h-10 max-w-[45vw] md:max-w-none object-contain"
                />
              ) : (
                currentBand?.name ?? 'Practice Portal'
              );
              return (
                <h1 className={currentBand?.logo ? 'flex min-w-0' : 'text-base md:text-lg font-semibold tracking-tight truncate'}>
                  {currentBand?.website ? (
                    <a
                      href={safeHref(currentBand.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={currentBand.website}
                      className="inline-block origin-left transition-transform hover:scale-105"
                    >
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                </h1>
              );
            })()}
          </div>
          {!editorFocus && (
            <div className="w-full order-last flex items-center gap-2 md:w-auto md:order-none md:absolute md:left-1/2 md:-translate-x-1/2">
              {/* Phones: setlist picker shares the song row */}
              {!isDesktop && <SetlistDropdown className="shrink-0 max-w-[38%] px-2" />}
              <SetlistNav />
            </div>
          )}
          {/* One right-aligned group. Two separate ml-auto items would split
              the free space and push the setlist picker behind the centered
              song picker. */}
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            {!editorFocus && isDesktop && <SetlistDropdown />}
            {showAdmin && !isDesktop && <AdminRibbon variant="menu" {...adminProps} />}
            <AccountMenu bandId={currentBand?.id} />
          </div>
        </header>
        {membersOpen && currentBand && (
          <MembersModal
            bandId={currentBand.id}
            bandName={currentBand.name}
            onClose={() => { setShowMembersModal(false); setFromRequestsLink(false); }}
          />
        )}

        {/* Admin toolbar: menus for what you may do here, plus nav links.
            Phones get the same things from the ☰ menu in the header. */}
        {showAdmin && isDesktop && <AdminRibbon {...adminProps} />}

        {/* Song loader (headless — runs effects only) */}
        <SongList />

        {/* Transport controls */}
        <TransportBar
          stickyTop={phonePageScroll ? headerHeight : undefined}
          showSliders={mobileControlsOpen}
          onToggleSliders={() =>
            setMobileControlsOpen((v) => {
              rememberPhonePanel('mixer', !v);
              return !v;
            })
          }
          minimal={editorFocus}
        />

        {/* Everything under the transport scrolls as one column, so a tall
            score (many instruments) can be scrolled past to the mixer below
            it instead of squeezing the mixer out of view. The editors fill
            it (flex-1 min-h-0) and scroll themselves, as before. On a phone
            with no editor open the whole page scrolls instead, header and
            transport too, so chords, lyrics and the mixer all have room. */}
        <div className={phonePageScroll ? 'flex flex-col shrink-0' : 'flex-1 min-h-0 flex flex-col overflow-y-auto'}>
          {/* Timestamp notes — sticky-note pop-ups anchored to playhead-windowed timestamps */}
          {!editorFocus && !showEditBandModal && <NotesLayer />}

          {/* Chord lane: below notes, above lyrics. On desktop the current
              chord starts on the lyric reading point. Under the chords
              editor it previews the draft. */}
          {!markerEditorOpen && !lyricsEditorOpen && !showEditBandModal && (
            <ChordLane overrideChords={chordsEditorOpen ? editorChords : undefined} />
          )}

          {/* Lyrics display \u2014 hidden when the tapMap or band editors
              occupy the page. Stays visible under the lyrics editor so
              the admin can sync against the live karaoke view. */}
          {!markerEditorOpen && !showEditBandModal && !(lyricsEditorOpen && lyricsEditorMode === 'lyrics') && (
            <LyricsDisplay
              overrideLines={lyricsEditorOpen ? editorLines : undefined}
              only={lyricsEditorOpen || chordsEditorOpen ? 'desktop' : undefined}
            />
          )}

          {/* Sheet music: the scrolling strip on wider screens, a button that
              opens it full screen on phones (ScrollingScore decides). Hidden
              under any of the on-page editors to give the editor full
              vertical space. */}
          {!editorFocus && !showEditBandModal && !sheetMinimized && (
            <ScrollingScore />
          )}

          {/* Editor replaces mixer when open */}
          {markerEditorOpen ? (
            <MarkerEditorModal />
          ) : lyricsEditorOpen ? (
            <LyricsEditorModal />
          ) : chordsEditorOpen ? (
            <ChordsEditorModal />
          ) : showEditBandModal && currentBand ? (
            <Suspense fallback={null}>
              <EditBandModal band={currentBand} onClose={() => setShowEditBandModal(false)} />
            </Suspense>
          ) : !selectedSong ? (
            <NoSongState onInvite={() => setShowMembersModal(true)} />
          ) : (
            <div className={mobileControlsOpen ? 'contents' : 'hidden md:contents'}>
              <MixerPanel />
            </div>
          )}
        </div>
      </div>
      {showDeleteModal && selectedSong && (
        <DeleteSongModal
          songId={selectedSong.id}
          songTitle={selectedSong.title}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
      {showSetlistModal && (
        <Suspense fallback={null}>
          <SetlistModal
            setlistId={editSetlistId}
            copyFromSetlistId={copySetlistId}
            onClose={() => { setShowSetlistModal(false); setEditSetlistId(undefined); setCopySetlistId(undefined); }}
          />
        </Suspense>
      )}
      {showDeleteSetlistModal && activeSetlist && (
        <Suspense fallback={null}>
          <DeleteSetlistModal
            setlistId={activeSetlist.id}
            setlistName={activeSetlist.name}
            onClose={() => setShowDeleteSetlistModal(false)}
          />
        </Suspense>
      )}
      {showViewAllSetlistsModal && (
        <Suspense fallback={null}>
          <ViewAllSetlistsModal
            onClose={() => setShowViewAllSetlistsModal(false)}
          />
        </Suspense>
      )}
      {showDeleteBandModal && currentBand && (
        <Suspense fallback={null}>
          <DeleteBandModal band={currentBand} onClose={() => setShowDeleteBandModal(false)} />
        </Suspense>
      )}
      {selectedSong?.videos && selectedSong.videos.length > 0 && (
        <YouTubeMiniPlayerStack
          videos={selectedSong.videos}
          admin={canEditContent}
          bandId={currentBand?.id}
        />
      )}
      <MinimizedRibbon />
      <UndoToast />
      {/* Not for guests: their access doesn't carry over to the home screen app. */}
      {signedIn && <HomeScreenOffer />}
    </AudioEngineContext.Provider>
  );
}
