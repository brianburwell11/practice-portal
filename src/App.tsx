import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { MixerPanel } from './components/mixer/MixerPanel';
import { MarkerEditorModal } from './components/marker-editor/MarkerEditorModal';
import { useMarkerEditorStore } from './store/markerEditorStore';
import { useSongStore } from './store/songStore';

export default function App() {
  const engine = useCreateEngine();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const openMarkerEditor = useMarkerEditorStore((s) => s.open);

  return (
    <AudioEngineContext.Provider value={engine}>
      <div className="min-h-screen flex flex-col bg-gray-900 text-gray-100">
        {/* Header */}
        <header className="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Practice Portal</h1>
          {selectedSong && (
            <button
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
              onClick={() =>
                openMarkerEditor(selectedSong.markers, selectedSong.beatOffset)
              }
            >
              Edit Markers
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
