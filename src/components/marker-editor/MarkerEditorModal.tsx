import { useState, useEffect, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { SectionList } from './SectionList';
import { parseXscFile } from '../../audio/xscParser';
import { autoLabelSection } from '../../audio/tapMapUtils';
import { buildXscContent } from '../../audio/xscExporter';
import { renderStereoDownmix } from '../../audio/mixdown';
import { encodeWav, interleaveStereo } from '../../admin/utils/audioConvert';

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
  const [exporting, setExporting] = useState(false);
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

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportXsc = async () => {
    if (tapMap.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const rendered = await renderStereoDownmix(engine);
      const interleaved = interleaveStereo(rendered);
      const wavBytes = encodeWav(interleaved, rendered.sampleRate, 2);

      const rawName =
        (selectedSong?.title && selectedSong.title.trim()) || selectedSong?.id || 'tapmap';
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');
      const wavFileName = `${safeName}.wav`;
      const xscFileName = `${safeName}.xsc`;

      const xscText = buildXscContent(tapMap, {
        wavFileName,
        wavInfo: {
          frameCount: rendered.length,
          channels: 2,
          sampleRate: rendered.sampleRate,
          durationSeconds: rendered.duration,
          totalBytes: wavBytes.byteLength,
          bitsPerSample: 16,
        },
      });

      triggerDownload(
        new Blob([xscText], { type: 'text/plain;charset=utf-8' }),
        xscFileName,
      );
      triggerDownload(new Blob([wavBytes], { type: 'audio/wav' }), wavFileName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar \u2014 mirrors the LyricsEditor layout: actions left/right,
          centered title, no song name (shown in the header above). */}
      <div className="relative flex items-center justify-between px-5 py-2">
        <h2 className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">
          Edit TapMap
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
          {error && (
            <span className="text-xs text-red-400 ml-2">{error}</span>
          )}
        </div>
        <div className="flex items-center gap-2 relative z-10">
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 transition-colors"
            onClick={handleExportXsc}
            disabled={tapMap.length === 0 || exporting}
            title="Download a Transcribe! .xsc plus a stereo downmix .wav of the current mixer state"
          >
            {exporting ? 'Exporting…' : 'Export .xsc'}
          </button>
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Section list \u2014 centered, narrow, fills all available space
          between the toolbar and the footer. Internal scroll kicks in
          when rows exceed that space; `min-h-0` keeps the flex child
          from growing past its parent and pushing the page taller. */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-3 max-w-2xl w-full mx-auto rounded-lg border border-gray-700">
        <SectionList />
      </div>

      {/* Footer hints — mirrors the LyricsEditor footer style so the
          two editors feel like the same family. `mt-auto` pins it to
          the bottom of the flex column so the panel's breathing room
          sits between the list and the footer. */}
      <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">S</kbd> section</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">M</kbd> measure</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">B</kbd> beat</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">click</kbd> select</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">drag</kbd> move</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Del</kbd> remove</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘Z</kbd> undo</span>
      </div>
    </div>
  );
}
