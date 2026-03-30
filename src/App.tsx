import { AudioEngineContext, useCreateEngine } from './hooks/useAudioEngine';
import { SongList } from './components/song-select/SongList';
import { TransportBar } from './components/transport/TransportBar';
import { MixerPanel } from './components/mixer/MixerPanel';

export default function App() {
  const engine = useCreateEngine();

  return (
    <AudioEngineContext.Provider value={engine}>
      <div className="min-h-screen flex flex-col bg-gray-900 text-gray-100">
        {/* Header */}
        <header className="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Practice Portal</h1>
        </header>

        {/* Song selector */}
        <SongList />

        {/* Transport controls */}
        <TransportBar />

        {/* Mixer */}
        <MixerPanel />
      </div>
    </AudioEngineContext.Provider>
  );
}
