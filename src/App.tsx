import { useState, lazy, Suspense } from 'react';
import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList, SetlistDropdown, SetlistNav } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { MixerPanel } from './components/mixer/MixerPanel';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { DeleteSongModal } from './components/song-select/DeleteSongModal';
import { AdminRibbon } from './admin/AdminRibbon';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { useSetlistStore } from './store/setlistStore';
import { useNavigate } from 'react-router-dom';


const SetlistModal = import.meta.env.DEV
  ? lazy(() => import('./admin/SetlistModal').then((m) => ({ default: m.SetlistModal })))
  : null;
const DeleteSetlistModal = import.meta.env.DEV
  ? lazy(() => import('./admin/DeleteSetlistModal').then((m) => ({ default: m.DeleteSetlistModal })))
  : null;

export default function App() {
  const engine = useCreateEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);
  const currentBand = useBandStore((s) => s.currentBand);
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSetlistModal, setShowSetlistModal] = useState(false);
  const [editSetlistId, setEditSetlistId] = useState<string | undefined>(undefined);
  const [showDeleteSetlistModal, setShowDeleteSetlistModal] = useState(false);
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
          className="relative px-4 py-3 border-b border-gray-700 flex items-center"
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
          <div className="absolute left-1/2 -translate-x-1/2">
            <SetlistNav />
          </div>
          <SetlistDropdown />
        </header>

        {/* Dev toolbar */}
        {import.meta.env.DEV && (
          <AdminRibbon
            hasSong={!!selectedSong}
            hasSetlist={!!activeSetlist}
            onAddSong={() => navigate(`/${bandRoute}/admin/add-song`)}
            onEditSong={() => selectedSong && navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`)}
            onTapMapEditor={() => selectedSong && openMarkerEditor(selectedSong.tapMap ?? [])}
            onDeleteSong={() => setShowDeleteModal(true)}
            onAddSetlist={() => { setEditSetlistId(undefined); setShowSetlistModal(true); }}
            onEditSetlist={() => { activeSetlist && setEditSetlistId(activeSetlist.id); setShowSetlistModal(true); }}
            onDeleteSetlist={() => setShowDeleteSetlistModal(true)}
          />
        )}

        {/* Song loader (headless — runs effects only) */}
        <SongList />

        {/* Transport controls */}
        <TransportBar />

        {/* Mixer */}
        <MixerPanel />
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
          <SetlistModal setlistId={editSetlistId} onClose={() => setShowSetlistModal(false)} />
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
    </AudioEngineContext.Provider>
  );
}
