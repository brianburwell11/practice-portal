import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useTransportStore } from '../../store/transportStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import type { LyricsData } from '../../audio/lyricsTypes';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LyricsEditorModal() {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const selectedSong = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);

  const {
    isOpen, lines, dirty, currentSyncIndex, selectedIndices, focusedIndex,
    close, updateLine, insertLineAfter, insertLines, syncLine,
    unsyncLine, unsyncSelected, deleteSelected, deleteLine,
    setCurrentSyncIndex, setSelectedIndices, setFocusedIndex,
    undo, redo, moveLineInDirection, duplicateLines, selectAll,
  } = useLyricsEditorStore();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus a row's input after render
  const focusRow = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const el = inputRefs.current[index];
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, []);

  // Auto-scroll to current sync row
  useEffect(() => {
    const el = rowRefs.current[currentSyncIndex];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentSyncIndex]);

  // Close with dirty confirmation
  const handleClose = useCallback(() => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    close();
  }, [dirty, close]);

  // Export lyrics as a plain text file. Instrumental lines become
  // `[instrumental]` so the export round-trips through the paste handler
  // on line 311. Blank text lines stay blank. Timestamps are omitted —
  // this is for human-readable reuse, not re-sync.
  const handleExport = useCallback(() => {
    if (!selectedSong) return;
    const content = lines
      .map((l) => (l.instrumental ? '[instrumental]' : l.text))
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSong.id}-lyrics.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lines, selectedSong]);

  // Save
  const handleSave = async () => {
    if (!currentBand || !selectedSong) return;
    setSaving(true);
    setError(null);
    try {
      const data: LyricsData = { lines };
      const res = await fetch(
        `/api/bands/${currentBand.id}/songs/${selectedSong.id}/lyrics`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) },
      );
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      useLyricsStore.getState().setLyrics(lines);
      close();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Global keydown handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const isFocused = focusedIndex !== null;

      // Tab — sync current line (always intercepted)
      if (e.key === 'Tab') {
        e.preventDefault();
        if (currentSyncIndex < lines.length) {
          syncLine(currentSyncIndex, position);
        }
        return;
      }

      // Cmd/Ctrl+I — insert instrumental
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        const after = focusedIndex ?? lines.length - 1;
        insertLineAfter(after, { text: '', time: null, instrumental: true });
        focusRow(after + 1);
        return;
      }

      // Cmd/Ctrl+Shift+Z — redo (only if not in input)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z') && !isFocused) {
        e.preventDefault();
        redo();
        return;
      }

      // Cmd/Ctrl+Z — undo (only if not in input, let native undo work there)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z' && !isFocused) {
        e.preventDefault();
        undo();
        return;
      }

      // Cmd/Ctrl+A — select all (only if not in input, let native select-all work there)
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !isFocused) {
        e.preventDefault();
        selectAll();
        return;
      }

      // Cmd/Ctrl+D — duplicate selected (only if not in input)
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !isFocused && selectedIndices.size > 0) {
        e.preventDefault();
        duplicateLines();
        return;
      }

      // Alt+ArrowUp/Down — move selected lines (only if not in input)
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isFocused && selectedIndices.size > 0) {
        e.preventDefault();
        moveLineInDirection(e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      // Space — play/pause (only if not typing)
      if (e.code === 'Space' && !isFocused) {
        e.preventDefault();
        playing ? engine.pause() : engine.play();
        return;
      }

      // Delete/Backspace — delete selected (only if not typing)
      if ((e.key === 'Backspace' || e.key === 'Delete') && !isFocused && selectedIndices.size > 0) {
        e.preventDefault();
        deleteSelected();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, focusedIndex, currentSyncIndex, lines.length, position, playing, engine, selectedIndices.size, syncLine, insertLineAfter, undo, redo, deleteSelected, moveLineInDirection, duplicateLines, selectAll, focusRow]);


  if (!isOpen || !selectedSong) return null;

  const contentLines = lines.filter((l) => l.text !== '' || l.instrumental);
  const syncedCount = contentLines.filter((l) => l.time !== null).length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="relative flex items-center justify-between px-5 py-2">
        <h2 className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-gray-100 pointer-events-none">Add/Edit Lyrics</h2>
        <div className="flex items-center gap-4">
          {selectedIndices.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-blue-400">{selectedIndices.size} selected</span>
              <button onClick={unsyncSelected} className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-yellow-300/80 hover:text-yellow-200 transition-colors">
                Clear timestamps
              </button>
              <button onClick={deleteSelected} className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-300 transition-colors">
                Delete lines
              </button>
              <button onClick={() => setSelectedIndices(new Set())} className="text-xs px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors">&times;</button>
            </div>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{syncedCount}/{contentLines.length} lyrics synced</span>
          <button
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-white transition-colors"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors"
            onClick={handleExport}
            title="Download lyrics as a .txt file (blank lines preserved; instrumental lines become [instrumental])"
          >
            Export .txt
          </button>
          <button className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>

      {/* Row list — centered, narrower, fixed height with own scrollbar */}
      <div ref={listRef} className="overflow-y-auto mt-3 max-w-2xl w-full mx-auto rounded-lg border border-gray-700" style={{ height: 'clamp(200px, 40vh, 400px)' }}>
        {lines.map((line, i) => {
          const isSynced = line.time !== null;
          const isSyncTarget = i === currentSyncIndex;
          const isSelected = selectedIndices.has(i);
          const isFocused = i === focusedIndex;

          return (
            <React.Fragment key={i}>
            <div
              ref={(el) => { rowRefs.current[i] = el; }}
              onClick={(e) => {
                // Single click: select row + seek (unless clicking line number or timestamp)
                if (focusedIndex === i) return; // already editing, don't interfere
                if (e.shiftKey) {
                  const from = Math.min(currentSyncIndex, i);
                  const to = Math.max(currentSyncIndex, i);
                  const next = new Set(selectedIndices);
                  for (let j = from; j <= to; j++) next.add(j);
                  setSelectedIndices(next);
                  return;
                }
                if (e.metaKey || e.ctrlKey) {
                  const next = new Set(selectedIndices);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  setSelectedIndices(next);
                  return;
                }
                setSelectedIndices(new Set());
                setCurrentSyncIndex(i);
                if (isSynced) engine.seek(line.time!);
              }}
              onDoubleClick={() => focusRow(i)}
              className={`group flex items-center gap-2 px-3 py-1.5 border-l-2 transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-blue-900/30 border-blue-500'
                  : isSyncTarget
                    ? 'bg-blue-900/20 border-blue-400'
                    : isFocused
                      ? 'bg-gray-800/60 border-transparent'
                      : 'border-transparent hover:bg-gray-800/30'
              }`}
            >
              {/* Line number / delete button */}
              <span className="w-6 text-right text-xs font-mono shrink-0 cursor-pointer group/num">
                <span className="group-hover/num:hidden text-gray-600">{i + 1}</span>
                <span className="hidden group-hover/num:inline text-red-400" onClick={(e) => { e.stopPropagation(); deleteLine(i); }}>&times;</span>
              </span>

              {/* Lyric text — readOnly until double-clicked; instrumental always readOnly */}
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                value={line.instrumental ? '🎶' : line.text}
                readOnly={line.instrumental || focusedIndex !== i}
                onChange={(e) => { if (!line.instrumental) updateLine(i, e.target.value); }}
                onMouseDown={(e) => { if (focusedIndex !== i) e.preventDefault(); }}
                onFocus={() => setFocusedIndex(i)}
                onBlur={() => setFocusedIndex(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    insertLineAfter(i);
                    focusRow(i + 1);
                  }
                  if (e.key === 'Backspace' && (line.instrumental || line.text === '')) {
                    e.preventDefault();
                    if (lines.length > 1) {
                      deleteLine(i);
                      focusRow(Math.max(0, i - 1));
                    }
                  }
                  if (e.altKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    moveLineInDirection('up');
                    if (i > 0) focusRow(i - 1);
                    return;
                  }
                  if (e.altKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    moveLineInDirection('down');
                    if (i < lines.length - 1) focusRow(i + 1);
                    return;
                  }
                  if (e.key === 'ArrowUp' && !e.altKey && i > 0) {
                    e.preventDefault();
                    focusRow(i - 1);
                  }
                  if (e.key === 'ArrowDown' && !e.altKey && i < lines.length - 1) {
                    e.preventDefault();
                    focusRow(i + 1);
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                    e.preventDefault();
                    duplicateLines();
                    focusRow(i + 1);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onPaste={(e) => {
                  if (line.instrumental) { e.preventDefault(); return; }
                  const raw = e.clipboardData.getData('text');
                  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                  if (text.includes('\n')) {
                    e.preventDefault();
                    const pastedLines = text.split('\n');
                    updateLine(i, line.text + pastedLines[0].trim());
                    const newLines = pastedLines.slice(1).map((t) => ({
                      text: t.trim(),
                      time: null,
                      ...(/^\[instrumental\]$/i.test(t.trim()) ? { instrumental: true, text: '' } : {}),
                    }));
                    if (newLines.length > 0) {
                      insertLines(i, newLines);
                      focusRow(i + newLines.length);
                    }
                  }
                }}
                className={`flex-1 bg-transparent border-none outline-none text-sm min-w-0 ${
                  line.instrumental ? 'italic text-gray-500' : 'text-gray-200 placeholder-gray-600'
                }`}
                placeholder={!line.instrumental && i === 0 && lines.length === 1 ? 'Double-click to add/edit lyrics...' : ''}
                spellCheck={false}
                autoComplete="off"
              />

              {/* Timestamp column */}
              <div className="w-36 shrink-0 text-right flex items-center justify-end gap-1.5">
                {isSyncTarget ? (
                  <div className="flex items-center gap-1.5">
                    <kbd className="text-[10px] font-mono px-1 py-0.5 bg-gray-700 rounded text-gray-300">TAB</kbd>
                    <span className="text-xs font-mono text-white">{formatTime(position)}</span>
                    {isSynced && (
                      <span className="text-xs font-mono text-yellow-400">{formatTime(line.time!)}</span>
                    )}
                  </div>
                ) : isSynced ? (
                  <button
                    onClick={() => unsyncLine(i)}
                    className="text-xs font-mono text-green-400 hover:text-red-400 transition-colors"
                    title="Click to unsync"
                  >
                    {formatTime(line.time!)}
                  </button>
                ) : null}
              </div>
            </div>
            {/* Keybind pills — shown below the focused/editing row */}
            {isFocused && (
              <div className="flex items-center gap-x-4 px-3 py-1 pl-9 text-[10px] text-gray-600">
                <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">↵</kbd> new line</span>
                <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘I</kbd> instrumental</span>
                <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌥↑↓</kbd> move line</span>
                <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘D</kbd> duplicate</span>
              </div>
            )}
          </React.Fragment>
          );
        })}
      </div>

      {/* Footer hints */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Space</kbd> play/pause</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Tab</kbd> sync</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘I</kbd> instrumental</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘D</kbd> duplicate</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌥↑↓</kbd> move</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘A</kbd> select all</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Shift</kbd>+click range</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Del</kbd> delete</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘Z</kbd> undo</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘⇧Z</kbd> redo</span>
      </div>
    </div>
  );
}
