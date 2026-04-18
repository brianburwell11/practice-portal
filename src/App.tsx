import { useState, lazy, Suspense } from 'react';
import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList, SetlistDropdown, SetlistNav } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { LyricsDisplay } from './components/LyricsDisplay';
import { MixerPanel } from './components/mixer/MixerPanel';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { LyricsEditorModal } from './components/lyrics-editor/LyricsEditorModal';
import { DeleteSongModal } from './components/song-select/DeleteSongModal';
import { AdminRibbon } from './admin/AdminRibbon';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useLyricsEditorStore } from './store/lyricsEditorStore';
import { r2Url } from './utils/url';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { useSetlistStore } from './store/setlistStore';
import { useNavigate } from 'react-router-dom';
import { useMixerPersistence } from './hooks/useMixerPersistence';


const SetlistModal = import.meta.env.DEV
  ? lazy(() => import('./admin/SetlistModal').then((m) => ({ default: m.SetlistModal })))
  : null;
const DeleteSetlistModal = import.meta.env.DEV
  ? lazy(() => import('./admin/DeleteSetlistModal').then((m) => ({ default: m.DeleteSetlistModal })))
  : null;
const EditBandModal = import.meta.env.DEV
  ? lazy(() => import('./admin/EditBandModal').then((m) => ({ default: m.EditBandModal })))
  : null;
const DeleteBandModal = import.meta.env.DEV
  ? lazy(() => import('./admin/DeleteBandModal').then((m) => ({ default: m.DeleteBandModal })))
  : null;

export default function App() {
  const engine = useCreateEngine();
  useMixerPersistence();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);
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
  const [showEditBandModal, setShowEditBandModal] = useState(false);
  const [showDeleteBandModal, setShowDeleteBandModal] = useState(false);
  const activeSetlist = useSetlistStore((s) => s.activeSetlist);

  const bandRoute = currentBand?.route ?? '';

  return (
    <AudioEngineContext.Provider value={engine}>
      <div
        className="min-h-screen flex flex-col"
        style={{
          backgroundColor: 'var(--band-bg, #111827)',
          color: 'var(--band-text, #f3f4f6)',
        }}
      >
        {/* Header */}
        <header
          className="px-4 py-3 border-b border-gray-700 flex flex-wrap items-center gap-y-2 md:relative"
          style={{ borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)' }}
        >
          {!currentBand?.logo ? (
            <h1 className="text-lg font-semibold tracking-tight">
              {currentBand?.name ?? 'Practice Portal'}
            </h1>
          ) : (
            <img
              src={currentBand.logo}
              alt={currentBand.name}
              className="h-10 object-contain"
            />
          )}
          <SetlistDropdown />
          <div className="w-full order-last flex justify-center md:w-auto md:order-none md:absolute md:left-1/2 md:-translate-x-1/2">
            <SetlistNav />
          </div>
        </header>

        {/* Admin toolbar (dev: full admin + nav links; prod: nav links only) */}
        {import.meta.env.DEV ? (
          <AdminRibbon
            setlistNavLinks={activeSetlist?.navLinks}
            songNavLinks={selectedSong?.navLinks}
            hasBand={!!currentBand}
            hasSong={!!selectedSong}
            hasSetlist={!!activeSetlist}
            onEditBand={() => {
              if (lyricsEditorOpen) {
                const dirty = useLyricsEditorStore.getState().dirty;
                if (dirty && !window.confirm('You have unsaved lyrics changes. Discard them?')) return;
                closeLyricsEditor();
              }
              setShowEditBandModal(true);
            }}
            onDeleteBand={() => setShowDeleteBandModal(true)}
            onAddSong={() => navigate(`/${bandRoute}/admin/add-song`)}
            onEditSong={() => selectedSong && navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`)}
            onTapMapEditor={() => selectedSong && openMarkerEditor(selectedSong.tapMap ?? [])}
            onLyricsEditor={() => {
              if (!selectedSong || !currentBand) return;
              setShowEditBandModal(false);
              fetch(r2Url(`${currentBand.id}/songs/${selectedSong.id}/lyrics.json`))
                .then((r) => (r.ok ? r.json() : { lines: [] }))
                .then((data) => openLyricsEditor(data.lines ?? []))
                .catch(() => openLyricsEditor([]));
            }}
            onDeleteSong={() => setShowDeleteModal(true)}
            onAddSetlist={() => { setEditSetlistId(undefined); setCopySetlistId(undefined); setShowSetlistModal(true); }}
            onEditSetlist={() => { if (activeSetlist) { setEditSetlistId(activeSetlist.id); setCopySetlistId(undefined); setShowSetlistModal(true); } }}
            onCopySetlist={() => { if (activeSetlist) { setEditSetlistId(undefined); setCopySetlistId(activeSetlist.id); setShowSetlistModal(true); } }}
            onDeleteSetlist={() => setShowDeleteSetlistModal(true)}
          />
        ) : (
          (activeSetlist?.navLinks?.length || selectedSong?.navLinks?.length) ? (
            <AdminRibbon setlistNavLinks={activeSetlist?.navLinks} songNavLinks={selectedSong?.navLinks} />
          ) : null
        )}

        {/* Song loader (headless — runs effects only) */}
        <SongList />

        {/* Transport controls */}
        <TransportBar />

        {/* Lyrics display — uses editor lines as live preview when editor is open */}
        <LyricsDisplay overrideLines={lyricsEditorOpen ? editorLines : undefined} />

        {/* Editor replaces mixer when open */}
        {lyricsEditorOpen ? (
          <LyricsEditorModal />
        ) : showEditBandModal && EditBandModal && currentBand ? (
          <Suspense fallback={null}>
            <EditBandModal band={currentBand} onClose={() => setShowEditBandModal(false)} />
          </Suspense>
        ) : (
          <MixerPanel />
        )}
      </div>

      <MarkerEditorModal />
      {showDeleteModal && selectedSong && (
        <DeleteSongModal
          songId={selectedSong.id}
          songTitle={selectedSong.title}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
      {showSetlistModal && SetlistModal && (
        <Suspense fallback={null}>
          <SetlistModal
            setlistId={editSetlistId}
            copyFromSetlistId={copySetlistId}
            onClose={() => { setShowSetlistModal(false); setEditSetlistId(undefined); setCopySetlistId(undefined); }}
          />
        </Suspense>
      )}
      {showDeleteSetlistModal && DeleteSetlistModal && activeSetlist && (
        <Suspense fallback={null}>
          <DeleteSetlistModal
            setlistId={activeSetlist.id}
            setlistName={activeSetlist.name}
            onClose={() => setShowDeleteSetlistModal(false)}
          />
        </Suspense>
      )}
      {showDeleteBandModal && DeleteBandModal && currentBand && (
        <Suspense fallback={null}>
          <DeleteBandModal band={currentBand} onClose={() => setShowDeleteBandModal(false)} />
        </Suspense>
      )}
    </AudioEngineContext.Provider>
  );
}
