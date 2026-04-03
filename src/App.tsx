import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { MixerPanel } from './components/mixer/MixerPanel';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useSongStore } from './store/songStore';
import { useBandStore } from './store/bandStore';
import { useNavigate } from 'react-router-dom';
import { assetUrl } from './utils/url';

export default function App() {
  const engine = useCreateEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);
  const currentBand = useBandStore((s) => s.currentBand);
  const navigate = useNavigate();

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
          className="px-4 py-3 border-b border-gray-700 flex items-center gap-3"
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
          {import.meta.env.DEV && (
            <button
              onClick={() => navigate(`/${bandRoute}/admin/add-song`)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              + Add Song
            </button>
          )}
          {import.meta.env.DEV && selectedSong && (
            <button
              onClick={() => navigate(`/${bandRoute}/admin/edit-song/${selectedSong.id}`)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Edit Song
            </button>
          )}
          {selectedSong && (
            <button
              className="px-3 py-1 text-sm rounded"
              style={{
                backgroundColor: 'var(--band-primary, #374151)',
                color: 'var(--band-text, #f3f4f6)',
              }}
              onClick={() =>
                openMarkerEditor(selectedSong.tapMap ?? [])
              }
            >
              TapMap Editor
            </button>
          )}
        </header>

        {/* Song selector */}
        <SongList />

        {/* Transport controls */}
        <TransportBar />

        {/* Mixer */}
        <MixerPanel />
      </div>

      <MarkerEditorModal />
    </AudioEngineContext.Provider>
  );
}
