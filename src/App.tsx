import { useState, lazy, Suspense } from 'react';
import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList, SongSelectDropdown } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { MixerPanel } from './components/mixer/MixerPanel';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { DeleteSongModal } from './components/song-select/DeleteSongModal';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { useNavigate } from 'react-router-dom';
import { assetUrl } from './utils/url';

const SetlistModal = import.meta.env.DEV
  ? lazy(() => import('./admin/SetlistModal').then((m) => ({ default: m.SetlistModal })))
  : null;

export default function App() {
  const engine = useCreateEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);
  const currentBand = useBandStore((s) => s.currentBand);
  const navigate = useNavigate();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSetlistModal, setShowSetlistModal] = useState(false);

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
              src={assetUrl(currentBand.logo)}
              alt={currentBand.name}
              className="h-10 object-contain"
            />
          )}
          <div className="absolute left-1/2 -translate-x-1/2">
            <SongSelectDropdown />
          </div>
        </header>

        {/* Dev toolbar */}
        {import.meta.env.DEV && (
          <div
            className="px-4 py-1.5 border-b border-gray-700 flex items-center gap-3"
            style={{ borderColor: 'color-mix(in srgb, var(--band-primary, #374151) 40%, transparent)' }}
          >
            <button
              onClick={() => navigate(`/${bandRoute}/admin/add-song`)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              + Add Song
            </button>
            {selectedSong && (
              <button
                onClick={() => navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Edit Song
              </button>
            )}
            {selectedSong && (
              <button
                onClick={() => openMarkerEditor(selectedSong.tapMap ?? [])}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                TapMap Editor
              </button>
            )}
            {selectedSong && (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="text-xs text-gray-500 hover:text-red-400"
              >
                Delete Song
              </button>
            )}
            <button
              onClick={() => setShowSetlistModal(true)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Create Setlist
            </button>
          </div>
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
          <SetlistModal onClose={() => setShowSetlistModal(false)} />
        </Suspense>
      )}
    </AudioEngineContext.Provider>
  );
}
