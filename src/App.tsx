import { useState, useEffect, lazy, Suspense } from 'react';
import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList, SetlistDropdown, SetlistNav } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { LyricsDisplay } from './components/LyricsDisplay';
import { NotesLayer } from './components/notes/NotesLayer';
import { UndoToast } from './components/notes/UndoToast';
import { useNotesKeyboard } from './hooks/useNotesKeyboard';
import { ScrollingScore } from './components/sheet/ScrollingScore';
import { MixerPanel } from './components/mixer/MixerPanel';
import { NoSongState } from './components/song-select/NoSongState';
import { MinimizedRibbon } from './components/MinimizedRibbon';
import { YouTubeMiniPlayerStack } from './components/youtube/YouTubeMiniPlayerStack';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { LyricsEditorModal } from './components/lyrics-editor/LyricsEditorModal';
import { DeleteSongModal } from './components/song-select/DeleteSongModal';
import { AdminRibbon } from './admin/AdminRibbon';
import { AccountMenu } from './components/account/AccountMenu';
import { MembersModal } from './components/account/MembersModal';
import { useSessionStore } from './store/sessionStore';
import { confirmDiscard, toast } from './store/dialogStore';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useLyricsEditorStore } from './store/lyricsEditorStore';
import { usePanelMinimizeStore } from './store/panelMinimizeStore';
import { useLyricsStore } from './store/lyricsStore';
import { dataUrl } from './utils/url';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { useSetlistStore } from './store/setlistStore';
import { Link, useNavigate } from 'react-router-dom';
import practicePortalLogo from './assets/practice-portal-logo.png';
import { useMixerPersistence } from './hooks/useMixerPersistence';


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
  const currentBand = useBandStore((s) => s.currentBand);
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSetlistModal, setShowSetlistModal] = useState(false);
  const [editSetlistId, setEditSetlistId] = useState<string | undefined>(undefined);
  const [copySetlistId, setCopySetlistId] = useState<string | undefined>(undefined);
  const [showDeleteSetlistModal, setShowDeleteSetlistModal] = useState(false);
  const [showViewAllSetlistsModal, setShowViewAllSetlistsModal] = useState(false);
  const [showEditBandModal, setShowEditBandModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  // Anything to manage here? Decides whether a Member sees the admin ribbon
  // at all (they don't — their screen is the public one). UX only.
  const myCaps = useSessionStore((s) => s.bands.find((b) => b.id === currentBand?.id)?.capabilities);
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
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);
  const sheetMinimized = usePanelMinimizeStore((s) =>
    s.items.some((x) => x.kind === 'panel' && x.id === 'sheet'),
  );
  const lyricsLoaded = useLyricsStore((s) => s.loaded);
  const lyricsLineCount = useLyricsStore((s) => s.lines.length);

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

  const bandRoute = currentBand?.route ?? '';

  return (
    <AudioEngineContext.Provider value={engine}>
      <div
        className="h-screen overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--band-bg, var(--color-page))',
          color: 'var(--band-text, #f3f4f6)',
        }}
      >
        {/* Header */}
        <header
          className="px-4 py-3 border-b border-gray-700 flex flex-wrap items-center gap-y-2 md:relative"
          style={{ borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)' }}
        >
          <div className="flex items-center gap-3">
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
                className="h-10 w-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
              />
            </Link>
            {(() => {
              const heading = currentBand?.logo ? (
                <img
                  src={currentBand.logo}
                  alt={currentBand.name}
                  className="h-10 object-contain"
                />
              ) : (
                <h1 className="text-lg font-semibold tracking-tight">
                  {currentBand?.name ?? 'Practice Portal'}
                </h1>
              );
              return currentBand?.website ? (
                <a
                  href={currentBand.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={currentBand.website}
                  className="inline-block origin-left transition-transform hover:scale-105"
                >
                  {heading}
                </a>
              ) : (
                heading
              );
            })()}
          </div>
          <div className="w-full order-last flex justify-center md:w-auto md:order-none md:absolute md:left-1/2 md:-translate-x-1/2">
            <SetlistNav />
          </div>
          {/* One right-aligned group. Two separate ml-auto items would split
              the free space and push the setlist picker behind the centered
              song picker. */}
          <div className="ml-auto flex items-center gap-3">
            <SetlistDropdown />
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

        {/* Admin toolbar: menus for what you may do here, plus nav links */}
        {(canManage || activeSetlist?.navLinks?.length || selectedSong?.navLinks?.length) ? (
          <AdminRibbon
            setlistNavLinks={activeSetlist?.navLinks}
            songNavLinks={selectedSong?.navLinks}
            hasBand={!!currentBand}
            hasSong={!!selectedSong}
            hasSetlist={!!activeSetlist}
            onManageMembers={() => setShowMembersModal(true)}
            onEditBand={async () => {
              if (lyricsEditorOpen) {
                const dirty = useLyricsEditorStore.getState().dirty;
                if (dirty && !(await confirmDiscard(LYRICS_UNSAVED))) return;
                closeLyricsEditor();
              }
              if (markerEditorOpen) {
                if (markerEditorDirty && !(await confirmDiscard(TAPMAP_UNSAVED))) return;
                closeMarkerEditor();
              }
              setShowEditBandModal(true);
            }}
            onDeleteBand={() => setShowDeleteBandModal(true)}
            onAddSong={() => navigate(`/${bandRoute}/admin/add-song`)}
            onEditSong={() => selectedSong && navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`)}
            onTapMapEditor={async () => {
              if (!selectedSong) return;
              if (lyricsEditorOpen) {
                const dirty = useLyricsEditorStore.getState().dirty;
                if (dirty && !(await confirmDiscard(LYRICS_UNSAVED))) return;
                closeLyricsEditor();
              }
              openMarkerEditor(selectedSong.tapMap ?? []);
            }}
            onLyricsEditor={async () => {
              if (!selectedSong || !currentBand) return;
              if (markerEditorOpen) {
                if (markerEditorDirty && !(await confirmDiscard(TAPMAP_UNSAVED))) return;
                closeMarkerEditor();
              }
              setShowEditBandModal(false);
              fetch(dataUrl(`${currentBand.id}/songs/${selectedSong.id}/lyrics.json`))
                .then((r) => (r.ok ? r.json() : { lines: [] }))
                .then((data) => openLyricsEditor(data.lines ?? []))
                .catch(() => openLyricsEditor([]));
            }}
            onDeleteSong={() => setShowDeleteModal(true)}
            onAddSetlist={() => { setEditSetlistId(undefined); setCopySetlistId(undefined); setShowSetlistModal(true); }}
            onEditSetlist={() => { if (activeSetlist) { setEditSetlistId(activeSetlist.id); setCopySetlistId(undefined); setShowSetlistModal(true); } }}
            onCopySetlist={() => { if (activeSetlist) { setEditSetlistId(undefined); setCopySetlistId(activeSetlist.id); setShowSetlistModal(true); } }}
            onDeleteSetlist={() => setShowDeleteSetlistModal(true)}
            onViewAllSetlists={() => setShowViewAllSetlistsModal(true)}
            onCopyGuestLink={() => { if (currentBand && activeSetlist) copyGuestLink(currentBand.id, activeSetlist.slug ?? activeSetlist.id); }}
          />
        ) : null}

        {/* Song loader (headless — runs effects only) */}
        <SongList />

        {/* Transport controls */}
        <TransportBar
          showSliders={mobileControlsOpen}
          onToggleSliders={() => setMobileControlsOpen((v) => !v)}
        />

        {/* Timestamp notes — sticky-note pop-ups anchored to playhead-windowed timestamps */}
        {!markerEditorOpen && !lyricsEditorOpen && !showEditBandModal && <NotesLayer />}

        {/* Lyrics display \u2014 hidden when the tapMap or band editors
            occupy the page. Stays visible under the lyrics editor so
            the admin can sync against the live karaoke view. */}
        {!markerEditorOpen && !showEditBandModal && (
          <LyricsDisplay overrideLines={lyricsEditorOpen ? editorLines : undefined} />
        )}

        {/* Scrolling sheet music \u2014 desktop only for now (md+). Hidden
            under any of the on-page editors to give the editor full
            vertical space. The current viewport/scroll math isn't usable
            on narrow screens and needs a dedicated mobile pass before we
            expose it there. */}
        {!markerEditorOpen && !lyricsEditorOpen && !showEditBandModal && !sheetMinimized && (
          <div className="hidden md:contents">
            <ScrollingScore />
          </div>
        )}

        {/* Editor replaces mixer when open */}
        {markerEditorOpen ? (
          <MarkerEditorModal />
        ) : lyricsEditorOpen ? (
          <LyricsEditorModal />
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
    </AudioEngineContext.Provider>
  );
}
