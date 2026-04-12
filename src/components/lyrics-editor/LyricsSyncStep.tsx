import { useEffect, useRef, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { EditorTransportControls } from '../marker-editor/EditorTransportControls';
import { getSections } from '../../audio/tapMapUtils';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LyricsSyncStep() {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const selectedSong = useSongStore((s) => s.selectedSong);

  const lines = useLyricsEditorStore((s) => s.lines);
  const currentLineIndex = useLyricsEditorStore((s) => s.currentLineIndex);
  const selectedIndices = useLyricsEditorStore((s) => s.selectedIndices);
  const syncLine = useLyricsEditorStore((s) => s.syncLine);
  const markInstrumental = useLyricsEditorStore((s) => s.markInstrumental);
  const unsyncLine = useLyricsEditorStore((s) => s.unsyncLine);
  const unsyncSelected = useLyricsEditorStore((s) => s.unsyncSelected);
  const deleteSelected = useLyricsEditorStore((s) => s.deleteSelected);
  const deleteLine = useLyricsEditorStore((s) => s.deleteLine);
  const setCurrentLineIndex = useLyricsEditorStore((s) => s.setCurrentLineIndex);
  const setSelectedIndices = useLyricsEditorStore((s) => s.setSelectedIndices);
  const undo = useLyricsEditorStore((s) => s.undo);

  const currentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seekLockUntilRef = useRef(0);

  // Follow playback — only advance forward so it doesn't fight syncLine's auto-advance
  // Backward jumps are handled explicitly by timeline/lyric click handlers
  // After an explicit seek, suppress follow until position advances past the lock time
  useEffect(() => {
    if (!playing) return;
    if (position < seekLockUntilRef.current) return;
    seekLockUntilRef.current = 0;
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time !== null && lines[i].text !== '' && lines[i].time! <= position) {
        best = i;
      }
    }
    if (best > currentLineIndex) {
      setCurrentLineIndex(best);
    }
  }, [playing, position, lines, currentLineIndex, setCurrentLineIndex]);

  // Auto-scroll to current line
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentLineIndex]);

  // Keyboard handlers
  const isLyric = (l: typeof lines[number]) => !l.instrumental && l.text !== '';
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      // Sync current lyric, then advance to next
      if (currentLineIndex < lines.length && isLyric(lines[currentLineIndex])) {
        syncLine(currentLineIndex, position);
      }
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      markInstrumental(position);
    }
    if (e.key === 'z' || (e.key === 'z' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      undo();
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedIndices.size > 0) {
      e.preventDefault();
      deleteSelected();
    }
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? engine.pause() : engine.play();
    }
  }, [currentLineIndex, lines.length, position, playing, engine, syncLine, markInstrumental, undo, selectedIndices.size, deleteSelected]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Section strip
  const sections = selectedSong?.tapMap ? getSections(selectedSong.tapMap) : [];
  const duration = selectedSong?.durationSeconds ?? 1;

  // Find current section for highlighting
  let currentSectionIdx = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].time <= position) {
      currentSectionIdx = i;
      break;
    }
  }

  const visibleLines = lines.filter((l) => l.instrumental || l.text !== '');
  const syncedCount = visibleLines.filter((l) => l.time !== null).length;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      {/* Transport + status + selection actions */}
      <div className="flex items-center justify-between">
        <EditorTransportControls />
        <div className="flex items-center gap-3">
          {selectedIndices.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-blue-400">{selectedIndices.size} selected</span>
              <button
                onClick={unsyncSelected}
                className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-yellow-300/80 hover:text-yellow-200 transition-colors"
              >
                Clear timestamps
              </button>
              <button
                onClick={deleteSelected}
                className="text-xs px-2 py-0.5 rounded bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-300 transition-colors"
              >
                Delete lines
              </button>
              <button
                onClick={() => setSelectedIndices(new Set())}
                className="text-xs px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
              >
                &times;
              </button>
            </div>
          )}
          <span className="text-xs text-gray-500">
            {syncedCount}/{visibleLines.length} synced
          </span>
        </div>
      </div>

      {/* Timeline scrubber with section markers and lyric markers */}
      <div
        className="relative h-8 bg-gray-800 rounded overflow-hidden shrink-0 cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).dataset.lyricIdx) return; // handled by marker click
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const time = pct * duration;
          engine.seek(time);
          if (!playing) engine.play();
          let best = -1;
          for (let j = 0; j < lines.length; j++) {
            if (lines[j].time !== null && lines[j].time! <= time) best = j;
          }
          if (best >= 0) {
            setCurrentLineIndex(best);
            let nextTime = Infinity;
            for (let j = best + 1; j < lines.length; j++) {
              if (lines[j].time !== null) { nextTime = lines[j].time!; break; }
            }
            seekLockUntilRef.current = nextTime;
          }
        }}
      >
        {/* Section markers */}
        {sections.map((s, i) => {
          const left = (s.time / duration) * 100;
          return (
            <div
              key={`s-${i}`}
              className={`absolute top-0 h-full flex items-end pb-0.5 px-1 text-[9px] font-medium border-l pointer-events-none ${
                i === currentSectionIdx
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                  : 'border-gray-600 text-gray-500'
              }`}
              style={{ left: `${left}%` }}
            >
              {s.label || `§${i + 1}`}
            </div>
          );
        })}
        {/* Lyric timestamp markers */}
        {lines.map((line, i) => {
          if (line.time === null || (!line.instrumental && line.text === '')) return null;
          const left = (line.time / duration) * 100;
          return (
            <div
              key={`l-${i}`}
              data-lyric-idx={i}
              className={`absolute top-0 h-full flex flex-col items-center cursor-pointer ${
                i === currentLineIndex ? 'text-blue-300' : 'text-gray-400 hover:text-blue-300'
              }`}
              style={{ left: `${left}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentLineIndex(i);
                let nextTime = Infinity;
                for (let j = i + 1; j < lines.length; j++) {
                  if (lines[j].time !== null) { nextTime = lines[j].time!; break; }
                }
                seekLockUntilRef.current = nextTime;
                engine.seek(line.time!);
                if (!playing) engine.play();
              }}
            >
              <span className="text-[8px] font-mono leading-none mt-px">{i + 1}</span>
              <div className="w-px flex-1 bg-current opacity-50" />
            </div>
          );
        })}
        {/* Playhead */}
        <div
          className="absolute top-0 h-full w-px bg-blue-400 pointer-events-none"
          style={{ left: `${(position / duration) * 100}%` }}
        />
      </div>

      {/* Lyrics list */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-gray-700">
        {lines.map((line, i) => {
          // Skip blank lines (spacers preserved for text round-trip)
          if (!line.instrumental && line.text === '') return null;
          const isCurrent = i === currentLineIndex;
          const isSelected = selectedIndices.has(i);
          const isSynced = line.time !== null;
          const isInstrumental = !!line.instrumental;

          return (
            <div
              key={i}
              ref={isCurrent ? currentRef : undefined}
              onClick={(e) => {
                if (e.shiftKey) {
                  // Range select from currentLineIndex to i
                  const from = Math.min(currentLineIndex, i);
                  const to = Math.max(currentLineIndex, i);
                  const next = new Set(selectedIndices);
                  for (let j = from; j <= to; j++) next.add(j);
                  setSelectedIndices(next);
                  return;
                }
                if (e.metaKey || e.ctrlKey) {
                  // Toggle single selection
                  const next = new Set(selectedIndices);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  setSelectedIndices(next);
                  setCurrentLineIndex(i);
                  return;
                }
                // Normal click — clear selection, set current, seek if synced
                setSelectedIndices(new Set());
                setCurrentLineIndex(i);
                if (isSynced) {
                  let nextTime = Infinity;
                  for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].time !== null) { nextTime = lines[j].time!; break; }
                  }
                  seekLockUntilRef.current = nextTime;
                  engine.seek(line.time!);
                  if (!playing) engine.play();
                }
              }}
              className={`group flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors border-l-2 ${
                isSelected
                  ? 'bg-blue-900/30 border-blue-500'
                  : isCurrent
                    ? 'bg-blue-900/40 border-blue-400'
                    : 'border-transparent hover:bg-gray-800/50'
              }`}
            >
              <span className="text-xs text-gray-600 w-6 text-right shrink-0 font-mono">
                {i + 1}
              </span>
              <span
                className={`flex-1 text-sm ${
                  isInstrumental
                    ? 'italic text-gray-500'
                    : isSynced
                      ? 'text-gray-200'
                      : 'text-gray-400'
                }`}
              >
                {isInstrumental ? '[Instrumental]' : line.text}
              </span>
              <span className={`text-xs font-mono shrink-0 ${isSynced ? 'text-green-400' : 'text-gray-600'}`}>
                {isSynced ? formatTime(line.time!) : '—'}
              </span>
              {isSynced && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    unsyncLine(i);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-yellow-400 transition-colors"
                  title="Clear timestamp"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteLine(i);
                }}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-colors"
                title="Delete line"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Keyboard hints */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-600 shrink-0">
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">L</kbd> sync line</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">I</kbd> instrumental</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Z</kbd> undo</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Space</kbd> play/pause</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Shift</kbd>+click range select</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘</kbd>+click toggle select</span>
        <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Del</kbd> delete selected</span>
      </div>
    </div>
  );
}
