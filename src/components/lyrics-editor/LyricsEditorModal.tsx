import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useLyricsEditorStore, type LyricsEditorMode } from '../../store/lyricsEditorStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { linesToText, textToLines } from '../../audio/lyricsMerge';
import type { LyricsData } from '../../audio/lyricsTypes';
import { confirmDialog, confirmDiscard } from '../../store/dialogStore';
import { LyricsTextPane } from './LyricsTextPane';
import { LyricsTimingPane } from './LyricsTimingPane';
import { LyricsDisplay } from '../LyricsDisplay';

const MODES: { id: LyricsEditorMode; label: string }[] = [
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'timing', label: 'Timing' },
];

/**
 * The lyrics editor, in two modes: Lyrics (write the words in a text
 * box) and Timing (stamp each line against the audio, then tune). This
 * shell owns the toolbar, import/export and save; each pane owns its own
 * controls and keyboard shortcuts.
 */
export function LyricsEditorModal() {
  const selectedSong = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const { isOpen, mode, lines, dirty, close, setMode, importLines } = useLyricsEditorStore();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Bumped on import so the text box reloads from the store. */
  const [importKey, setImportKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close the More menu on outside tap/click
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!moreMenuRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [moreOpen]);

  const handleClose = useCallback(async () => {
    if (dirty && !(await confirmDiscard())) return;
    close();
  }, [dirty, close]);

  // Export as plain text, the same shape as the text box. Timestamps are
  // left out: this is for reuse, not re-sync.
  const handleExport = useCallback(() => {
    if (!selectedSong) return;
    const blob = new Blob([linesToText(lines)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSong.id}-lyrics.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lines, selectedSong]);

  // Import a plain text file, replacing everything (after a confirm when
  // there is already content).
  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const raw = (reader.result as string).replace(/\r\n?/g, '\n');
        // Drop a single trailing newline but keep blank lines inside.
        const parsed = textToLines(raw.endsWith('\n') ? raw.slice(0, -1) : raw);
        const hasContent = lines.some((l) => l.text !== '' || l.instrumental);
        if (hasContent && !(await confirmDialog({ title: 'Replace the existing lyrics?', confirmLabel: 'Replace', danger: true }))) return;
        importLines(parsed);
        setImportKey((k) => k + 1);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [lines, importLines],
  );

  const handleSave = async () => {
    if (!currentBand || !selectedSong) return;
    setSaving(true);
    setError(null);
    try {
      // Trailing blank lines are just the end of the text box.
      let end = lines.length;
      while (end > 0 && lines[end - 1].text === '' && !lines[end - 1].instrumental) end--;
      const data: LyricsData = { lines: lines.slice(0, end) };
      const res = await fetch(
        `/api/bands/${currentBand.id}/songs/${selectedSong.id}/lyrics`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      );
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      useLyricsStore.getState().setLyrics(data.lines);
      close();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !selectedSong) return null;

  const btn = 'px-2.5 md:px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors';
  const menuItem = 'block w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors';

  return (
    <div className="theme-default bg-page flex-1 flex flex-col min-h-0">
      {/* Toolbar: mode switch on the left, file actions and save on the right */}
      <div className="flex items-center justify-between gap-2 px-3 md:px-5 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-gray-800 shrink-0" role="tablist" aria-label="Editor mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  mode === m.id ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {error && <span className="text-xs text-red-400 truncate">{error}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className={`${btn} hidden md:inline-block`}
            onClick={() => fileInputRef.current?.click()}
            title="Import lyrics from a .txt file (blank lines preserved; #INSTRUMENTAL or [Instrumental] lines become instrumental)"
          >
            Import .txt
          </button>
          <button
            className={`${btn} hidden md:inline-block`}
            onClick={handleExport}
            title="Download lyrics as a .txt file"
          >
            Export .txt
          </button>
          {mode === 'lyrics' && <div ref={moreMenuRef} className="relative md:hidden">
            <button className={btn} onClick={() => setMoreOpen((v) => !v)}>
              More ▾
            </button>
            {moreOpen && (
              <div className="theme-default absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded border border-gray-600 bg-gray-800 shadow-lg py-1">
                <button className={menuItem} onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}>
                  Import .txt
                </button>
                <button className={menuItem} onClick={() => { setMoreOpen(false); handleExport(); }}>
                  Export .txt
                </button>
              </div>
            )}
          </div>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={handleImport}
          />
          <button
            className="px-3 md:px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-accent-ink transition-colors"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button className={btn} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>

      {/* Phones: the karaoke preview sits under the toolbar in Timing
          mode (desktop shows its track above the editor). */}
      {mode === 'timing' && <LyricsDisplay overrideLines={lines} only="mobile" />}

      {mode === 'lyrics' ? <LyricsTextPane key={importKey} /> : <LyricsTimingPane />}
    </div>
  );
}
