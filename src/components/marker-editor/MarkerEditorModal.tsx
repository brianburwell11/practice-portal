import { useState, useEffect, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { SectionList } from './SectionList';
import { parseXscFile } from '../../audio/xscParser';
import { autoLabelSection } from '../../audio/tapMapUtils';

export function MarkerEditorModal() {
  const {
    isOpen, tapMap, dirty, selectedIndex,
    close, importTapMap, addEntry, deleteEntry, undo, onComplete,
  } = useMarkerEditorStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const setSelectedSong = useSongStore((s) => s.setSelectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const engine = useAudioEngine();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts \u2014 S/M/B add an entry at the current playhead,
  // Backspace/Delete removes the selected one, Z (or Cmd/Ctrl+Z) undoes.
  // Guarded to only fire while the editor is open so the bindings don't
  // interfere with normal app use.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if (selectedIndex !== null && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        deleteEntry(selectedIndex);
        return;
      }

      const key = e.key.toUpperCase();
      if (key === 'Z') { undo(); return; }

      const currentPos = engine.clock.currentTime;
      if (key === 'S') {
        addEntry({ time: currentPos, type: 'section', label: autoLabelSection(tapMap) });
      } else if (key === 'M') {
        addEntry({ time: currentPos, type: 'measure' });
      } else if (key === 'B') {
        addEntry({ time: currentPos, type: 'beat' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, selectedIndex, tapMap, engine, addEntry, deleteEntry, undo]);

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
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar — matches the LyricsEditor pattern: centered title,
          actions on left/right. The waveform above now doubles as the
          editor canvas (tapMap entries are sourced from this store while
          the editor is open), so we only render the toolbar and the
          section list here. */}
      <div className="relative flex items-center justify-between px-5 py-2 border-b border-gray-700">
        <h2 className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">
          TapMap Editor
          {selectedSong?.title && (
            <span className="ml-2 text-gray-400 font-normal">· {selectedSong.title}</span>
          )}
        </h2>
        <div className="flex items-center gap-2 relative z-10">
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
        </div>
        <div className="flex items-center gap-2 relative z-10">
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

      {/* Keyboard shortcut legend */}
      <div className="px-5 py-2 text-xs text-gray-500 border-b border-gray-800 font-mono">
        <span className="text-gray-300">S</span> section
        <span className="mx-1.5">·</span>
        <span className="text-gray-300">M</span> measure
        <span className="mx-1.5">·</span>
        <span className="text-gray-300">B</span> beat
        <span className="mx-3 text-gray-700">|</span>
        <span className="text-gray-300">click</span> select
        <span className="mx-1.5">·</span>
        <span className="text-gray-300">drag</span> move
        <span className="mx-1.5">·</span>
        <span className="text-gray-300">Del</span> remove
        <span className="mx-1.5">·</span>
        <span className="text-gray-300">⌘Z</span> undo
      </div>

      {/* Section list */}
      <div className="flex-1 min-h-0 overflow-auto px-5 pb-4 pt-2">
        <SectionList />
      </div>
    </div>
  );
}
