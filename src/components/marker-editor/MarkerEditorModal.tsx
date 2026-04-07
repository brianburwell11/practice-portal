import { useState, useCallback, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useTransportStore } from '../../store/transportStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { MarkerEditorCanvas } from './MarkerEditorCanvas';
import { TimelineNavigator } from './TimelineNavigator';
import { EditorTransportControls } from './EditorTransportControls';
import { SectionList } from './SectionList';
import { parseXscFile } from '../../audio/xscParser';

export function MarkerEditorModal() {
  const { isOpen, tapMap, dirty, close, importTapMap, onComplete } =
    useMarkerEditorStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const engine = useAudioEngine();
  const duration = useTransportStore((s) => s.duration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(Math.min(30, duration || 30));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleViewChange = useCallback((newStart: number) => {
    const maxStart = Math.max(0, (duration || 0) - viewDuration);
    setViewStart(Math.max(0, Math.min(maxStart, newStart)));
  }, [duration, viewDuration]);

  const handleSeek = useCallback((seconds: number) => {
    engine.seek(Math.max(0, Math.min(seconds, duration || 0)));
  }, [engine, duration]);

  if (!isOpen || (!selectedSong && !onComplete)) return null;

  const handleSave = async () => {
    if (onComplete) {
      onComplete(tapMap);
      close();
      return;
    }

    if (!selectedSong) return;

    setSaving(true);
    setError(null);

    const updatedConfig = {
      ...selectedSong,
      tapMap: tapMap,
    };

    try {
      const res = await fetch(`/api/bands/${currentBand!.id}/songs/${selectedSong.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      if (!res.ok) {
        throw new Error(`Save failed: ${res.status} ${res.statusText}`);
      }

      setSelectedSong(updatedConfig);
      close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Discard them?',
      );
      if (!confirmed) return;
    }
    close();
  };

  const handleImportXsc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const entries = parseXscFile(content);
      if (tapMap.length > 0) {
        if (!window.confirm('Replace existing tap map?')) return;
      }
      importTapMap(entries);
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-100">
            TapMap Editor
          </h2>
          <span className="text-sm text-gray-400">
            {selectedSong?.title ?? 'New Song'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            Import .xsc
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xsc"
            className="hidden"
            onChange={handleImportXsc}
          />
          {error && (
            <span className="text-xs text-red-400 mr-2">{error}</span>
          )}
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 px-5 pt-4">
        <MarkerEditorCanvas
          viewStart={viewStart}
          viewDuration={viewDuration}
          onViewChange={handleViewChange}
          onViewDurationChange={setViewDuration}
        />
      </div>

      {/* Timeline navigator */}
      <div className="px-5 pt-2">
        <TimelineNavigator
          viewStart={viewStart}
          viewDuration={viewDuration}
          onViewChange={handleViewChange}
          onSeek={handleSeek}
        />
      </div>

      {/* Transport controls */}
      <div className="px-5 py-3">
        <EditorTransportControls />
      </div>

      {/* Section list */}
      <div className="px-5 pb-4 pt-2">
        <SectionList />
      </div>
    </div>
  );
}
