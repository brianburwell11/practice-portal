import { useState, useCallback } from 'react';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { MarkerEditorCanvas } from './MarkerEditorCanvas';
import { TimelineNavigator } from './TimelineNavigator';
import { EditorTransportControls } from './EditorTransportControls';
import { TapBeatOffset } from './TapBeatOffset';
import { MarkerForm } from './MarkerForm';
import { MarkerList } from './MarkerList';

export function MarkerEditorModal() {
  const { isOpen, markers, beatOffset, editingMarkerIndex, dirty, close, updateMarker, setEditingMarker } =
    useMarkerEditorStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const engine = useAudioEngine();
  const duration = useTransportStore((s) => s.duration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const viewDuration = Math.min(10, duration || 10);

  const handleViewChange = useCallback((newStart: number) => {
    const maxStart = Math.max(0, (duration || 0) - viewDuration);
    setViewStart(Math.max(0, Math.min(maxStart, newStart)));
  }, [duration, viewDuration]);

  const handleSeek = useCallback((seconds: number) => {
    engine.seek(Math.max(0, Math.min(seconds, duration || 0)));
  }, [engine, duration]);

  if (!isOpen || !selectedSong) return null;

  const editingMarker =
    editingMarkerIndex !== null ? markers[editingMarkerIndex] : null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const updatedConfig = {
      ...selectedSong,
      markers,
      beatOffset,
    };

    try {
      const res = await fetch(`/api/song/${selectedSong.id}/config`, {
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

  const handleFormConfirm = (name: string, color: string) => {
    if (editingMarkerIndex !== null) {
      updateMarker(editingMarkerIndex, { name, color });
    }
    setEditingMarker(null);
  };

  const handleFormCancel = () => {
    setEditingMarker(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto">
      <div className="max-w-5xl w-full mx-auto mt-8 mb-8 bg-gray-800 rounded-xl shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-100">
              Marker Editor
            </h2>
            <span className="text-sm text-gray-400">
              {selectedSong.title}
            </span>
            <span className="text-xs text-gray-500 font-mono">
              offset: {beatOffset.toFixed(3)}s
            </span>
          </div>
          <div className="flex items-center gap-2">
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
        <div className="px-5 pt-4">
          <MarkerEditorCanvas
            viewStart={viewStart}
            viewDuration={viewDuration}
            onViewChange={handleViewChange}
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

        {/* Transport + Tap beat offset */}
        <div className="flex items-center justify-between px-5 py-3 gap-4">
          <EditorTransportControls />
          <TapBeatOffset />
        </div>

        {/* Marker form (if editing) */}
        {editingMarker && editingMarkerIndex !== null && (
          <div className="px-5 pb-2">
            <MarkerForm
              beat={editingMarker.beat}
              initialName={editingMarker.name}
              initialColor={editingMarker.color}
              onConfirm={handleFormConfirm}
              onCancel={handleFormCancel}
            />
          </div>
        )}

        {/* Marker list */}
        <div className="px-5 pb-4 pt-2">
          <MarkerList />
        </div>
      </div>
    </div>
  );
}
