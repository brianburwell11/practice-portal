import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useChordsEditorStore } from '../../store/chordsEditorStore';
import { beatGrid, cellFor, isOffGrid, lastAtOrBefore, pushTimeFor, type GridLine } from '../../audio/chordGrid';
import { normalizeChord } from '../../audio/chordSymbols';
import type { ChordEvent } from '../../audio/chordsTypes';
import { formatPrecise } from './time';
import { chordsInRange, copyRange, pasteEdit } from './gridRange';

/** Playing from the cursor starts this many seconds early. */
const PLAY_LEAD = 1;

interface Bar {
  /** Grid indexes of this bar's beats. */
  cells: number[];
  /** Section name when a section starts on this bar. */
  label?: string;
}

interface Placed {
  chord: ChordEvent;
  push: boolean;
  offGrid: boolean;
}

/** Group the beat grid into bars: a new bar at every bar line. */
function toBars(grid: GridLine[]): Bar[] {
  const bars: Bar[] = [];
  grid.forEach((line, i) => {
    if (line.bar || bars.length === 0) bars.push({ cells: [], label: line.label });
    bars[bars.length - 1].cells.push(i);
  });
  return bars;
}

/**
 * Grid mode: type chords onto the song's beat grid, one cell per beat.
 * Space = next beat, Tab = next bar, Shift goes back, `/` repeats the last
 * chord, `%` copies the previous bar, `<` pushes a chord to the "and"
 * before its beat. The cursor cell is a real text input, so the app's
 * single-key shortcuts (m, s, n…) stay out of the way while typing.
 */
export function ChordsGridPane() {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const timeSignatureMap = useSongStore((s) => s.selectedSong?.timeSignatureMap);
  const { chords, applyEdit, undo, redo, setMode, clipboard, setClipboard } = useChordsEditorStore();
  const desktop = useMediaQuery('(min-width: 768px)');
  /** Rows hold this many beats, chart style, so every beat box is the same
   *  width whether a bar has 2 beats or 8. A longer bar gets a row of its own. */
  const beatsPerRow = desktop ? 16 : 8;

  const grid = useMemo(() => beatGrid(tapMap, timeSignatureMap), [tapMap, timeSignatureMap]);
  const bars = useMemo(() => toBars(grid), [grid]);
  const barOf = useMemo(() => {
    const out: number[] = [];
    bars.forEach((b, bi) => b.cells.forEach((c) => { out[c] = bi; }));
    return out;
  }, [bars]);

  // Bars wrap into rows by beat count; `cols` is the row's width in beats.
  const { rows, rowOf } = useMemo(() => {
    const rows: { bars: number[]; cols: number }[] = [];
    let current: number[] = [];
    let used = 0;
    bars.forEach((b, bi) => {
      if (current.length > 0 && used + b.cells.length > beatsPerRow) {
        rows.push({ bars: current, cols: Math.max(beatsPerRow, used) });
        current = [];
        used = 0;
      }
      current.push(bi);
      used += b.cells.length;
    });
    if (current.length > 0) rows.push({ bars: current, cols: Math.max(beatsPerRow, used) });
    const rowOf: number[] = [];
    rows.forEach((r, ri) => r.bars.forEach((bi) => { rowOf[bi] = ri; }));
    return { rows, rowOf };
  }, [bars, beatsPerRow]);

  // Which chord is written in which cell; free-time chords are listed apart.
  const { byCell, free } = useMemo(() => {
    const byCell = new Map<number, Placed>();
    const free: ChordEvent[] = [];
    for (const chord of chords) {
      const cell = cellFor(chord.time, grid);
      if (!cell) free.push(chord);
      else byCell.set(cell.index, { chord, push: cell.push, offGrid: isOffGrid(chord.time, grid) });
    }
    return { byCell, free };
  }, [chords, grid]);

  const [cursor, setCursor] = useState(0);
  /** The other end of a Shift-selected range (the cursor is this end), or null. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [buffer, setBuffer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastTyped, setLastTyped] = useState<{ typed: string; stored: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const playIdx = lastAtOrBefore(grid, position);
  const cursorRow = rowOf[barOf[cursor] ?? 0] ?? 0;
  const playRow = playIdx >= 0 ? rowOf[barOf[playIdx] ?? 0] ?? -1 : -1;

  // Keep the cursor's row in view, and the playing row while playing.
  useEffect(() => {
    rowRefs.current[cursorRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursorRow]);
  useEffect(() => {
    if (playing && playRow >= 0) rowRefs.current[playRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playing, playRow]);

  if (grid.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto max-w-2xl w-full mx-auto px-3 md:px-0 py-4 text-sm text-gray-400 space-y-2">
        <p>This song has no tapMap, so there's no beat grid to type on.</p>
        <p>
          Use{' '}
          <button type="button" className="underline text-gray-200" onClick={() => setMode('stamp')}>Stamp</button>{' '}
          to tap chords in as the song plays, or add a tapMap in the TapMap Editor first.
        </p>
        <FreeTimeList chords={free} />
      </div>
    );
  }

  const cellTime = (i: number) => grid[i].time;
  const placedTime = (i: number, push: boolean) => (push ? pushTimeFor(i, grid) : cellTime(i));
  const clamp = (i: number) => Math.max(0, Math.min(grid.length - 1, i));
  const barStart = (i: number) => bars[barOf[i]].cells[0];

  /** Store the typed chord at the cursor. False (and an error) if it isn't a chord. */
  const commit = (): boolean => {
    if (!buffer.trim()) {
      setBuffer('');
      return true;
    }
    const stored = normalizeChord(buffer);
    if (!stored) {
      setError(`"${buffer.trim()}" isn't a chord name I know`);
      return false;
    }
    const existing = byCell.get(cursor);
    applyEdit(existing ? [existing.chord.time] : [], [{ symbol: stored, time: placedTime(cursor, existing?.push ?? false) }]);
    setLastTyped({ typed: buffer.trim(), stored });
    setBuffer('');
    setError(null);
    return true;
  };

  /** Move the cursor; a plain move drops any selection. */
  const moveTo = (i: number) => {
    setAnchor(null);
    setCursor(clamp(i));
    inputRef.current?.focus();
  };

  /** Move the cursor, growing the selection from where it started. */
  const extendTo = (i: number) => {
    setAnchor((a) => (a === null ? cursor : a));
    setCursor(clamp(i));
    inputRef.current?.focus();
  };

  const rangeLo = anchor === null ? cursor : Math.min(anchor, cursor);
  const rangeHi = anchor === null ? cursor : Math.max(anchor, cursor);

  const copySelection = () => setClipboard(copyRange(chords, grid, rangeLo, rangeHi));

  const deleteSelection = () => {
    const times = chordsInRange(chords, grid, rangeLo, rangeHi);
    if (times.length) applyEdit(times, []);
  };

  /** Paste over the span starting at the selection (or cursor), beat for beat. */
  const paste = () => {
    if (!clipboard) return;
    const { remove, add, end } = pasteEdit(chords, grid, clipboard, rangeLo);
    applyEdit(remove, add);
    setAnchor(rangeLo);
    setCursor(end);
    inputRef.current?.focus();
  };

  const prevChordBefore = (t: number) => {
    const i = lastAtOrBefore(chords, t - 0.001);
    return i >= 0 ? chords[i].symbol : null;
  };

  // Reads the store, not this render's `byCell`: `<` right after typing a
  // chord pushes the chord that commit just placed.
  const togglePush = () => {
    const existing = useChordsEditorStore.getState().chords.find((c) => cellFor(c.time, grid)?.index === cursor);
    if (!existing) return;
    const pushed = cellFor(existing.time, grid)!.push;
    applyEdit([existing.time], [{ symbol: existing.symbol, time: placedTime(cursor, !pushed) }]);
  };

  const removeAtCursor = () => {
    const existing = byCell.get(cursor);
    if (existing) applyEdit([existing.chord.time], []);
  };

  /** `%`: this bar becomes a copy of the previous one, beat for beat. */
  const copyPreviousBar = () => {
    const bi = barOf[cursor];
    if (bi === 0) return;
    const from = bars[bi - 1].cells;
    const to = bars[bi].cells;
    const clip = copyRange(chords, grid, from[0], from[from.length - 1]);
    // A bar of a different length takes what fits.
    const { remove, add } = pasteEdit(chords, grid, { ...clip, length: to.length, items: clip.items.filter((it) => it.offset < to.length) }, to[0]);
    applyEdit(remove, add);
    moveTo(bars[bi + 1]?.cells[0] ?? cursor);
  };

  const playFromCursor = () => {
    if (playing) {
      engine.pause();
      return;
    }
    engine.seek(Math.max(0, cellTime(cursor) - PLAY_LEAD));
    engine.play();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (commit()) playFromCursor();
      return;
    }
    // Select all / copy / cut / paste act on the grid unless there's typed
    // text, which keeps the input's own behaviour.
    if (mod && !buffer && ['a', 'c', 'x', 'v'].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === 'v' && !clipboard) return;
      e.preventDefault();
      if (k === 'a') {
        setAnchor(0);
        setCursor(grid.length - 1);
      } else if (k === 'c') {
        copySelection();
      } else if (k === 'x') {
        copySelection();
        deleteSelection();
      } else {
        paste();
      }
      return;
    }
    if (mod || e.altKey) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (commit()) moveTo(cursor + (e.shiftKey ? -1 : 1));
        return;
      case 'Tab': {
        e.preventDefault();
        if (!commit()) return;
        const start = barStart(cursor);
        const bi = barOf[cursor];
        if (e.shiftKey) moveTo(cursor === start ? (bars[bi - 1]?.cells[0] ?? 0) : start);
        else moveTo(bars[bi + 1]?.cells[0] ?? cursor);
        return;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (buffer) return; // move the caret inside the typed name
        e.preventDefault();
        const to = cursor + (e.key === 'ArrowRight' ? 1 : -1);
        if (e.shiftKey) extendTo(to);
        else moveTo(to);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!commit()) return;
        // Same beat column in the row above or below (or that row's last beat).
        const row = rows[Math.max(0, Math.min(rows.length - 1, cursorRow + (e.key === 'ArrowDown' ? 1 : -1)))];
        let want = 0;
        for (const bi of rows[cursorRow].bars) {
          if (bi === barOf[cursor]) break;
          want += bars[bi].cells.length;
        }
        want += cursor - barStart(cursor);
        const lastBar = bars[row.bars[row.bars.length - 1]];
        let to = lastBar.cells[lastBar.cells.length - 1];
        let col = 0;
        for (const bi of row.bars) {
          const n = bars[bi].cells.length;
          if (want < col + n) {
            to = bars[bi].cells[want - col];
            break;
          }
          col += n;
        }
        if (e.shiftKey) extendTo(to);
        else moveTo(to);
        return;
      }
      case 'Enter':
        e.preventDefault();
        commit();
        return;
      case 'Escape':
        e.preventDefault();
        setBuffer('');
        setError(null);
        setAnchor(null);
        return;
      case 'Backspace':
      case 'Delete':
        if (buffer) return;
        e.preventDefault();
        if (anchor !== null) deleteSelection();
        else removeAtCursor();
        return;
      case '/':
        if (buffer) return; // a slash chord: D/F#
        e.preventDefault();
        {
          const prev = prevChordBefore(cellTime(cursor));
          if (prev) applyEdit(byCell.get(cursor) ? [byCell.get(cursor)!.chord.time] : [], [{ symbol: prev, time: cellTime(cursor) }]);
        }
        moveTo(cursor + 1);
        return;
      case '%':
        if (buffer) return;
        e.preventDefault();
        copyPreviousBar();
        return;
      case '<':
        e.preventDefault();
        if (commit()) togglePush();
        return;
    }
  };

  const onCellDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    if (!commit()) {
      inputRef.current?.focus();
      return;
    }
    // Shift+click selects up to here and leaves the playhead alone.
    if (e.shiftKey) {
      extendTo(i);
      return;
    }
    moveTo(i);
    engine.seek(cellTime(i));
  };


  const tool = 'rounded bg-gray-700 hover:bg-gray-600 px-2.5 py-1.5 text-xs text-gray-300';
  // Toolbar buttons mustn't take focus from the cursor cell's input.
  const noFocus = (e: React.PointerEvent) => e.preventDefault();
  const cursorChord = byCell.get(cursor);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 md:px-5 pb-2">
        {anchor !== null ? (
          <span className="text-xs text-blue-300">
            {barOf[rangeLo] === barOf[rangeHi] ? `Bar ${barOf[rangeLo] + 1}` : `Bars ${barOf[rangeLo] + 1}–${barOf[rangeHi] + 1}`} selected
            ({rangeHi - rangeLo + 1} {rangeHi === rangeLo ? 'beat' : 'beats'}): ⌘C copy, ⌘X cut, ⌘V paste, ⌫ delete
          </span>
        ) : (
          <span className="text-xs text-gray-500 font-mono">
            Bar {barOf[cursor] + 1}, beat {cursor - barStart(cursor) + 1} · {formatPrecise(cellTime(cursor))}
          </span>
        )}
        <span className="flex-1" />
        <button type="button" className={tool} onPointerDown={noFocus} onClick={() => { if (commit()) moveTo(cursor - 1); }}>‹ Beat</button>
        <button type="button" className={tool} onPointerDown={noFocus} onClick={() => { if (commit()) moveTo(cursor + 1); }}>Beat ›</button>
        <button type="button" className={tool} onPointerDown={noFocus} onClick={() => { if (commit()) moveTo(bars[barOf[cursor] + 1]?.cells[0] ?? cursor); }}>Bar ›</button>
        <button type="button" className={tool} disabled={!cursorChord} onPointerDown={noFocus} onClick={() => { if (commit()) togglePush(); }}>
          {cursorChord?.push ? 'Unpush' : 'Push'}
        </button>
        <button type="button" className={tool} disabled={!cursorChord} onPointerDown={noFocus} onClick={removeAtCursor}>Delete</button>
        <button type="button" className={tool} onPointerDown={noFocus} onClick={() => { if (commit()) playFromCursor(); }}>
          {playing ? 'Pause' : 'Play from here'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 pb-3">
        <FreeTimeList chords={free} onStamp={() => setMode('stamp')} />
        <div className="space-y-2">
          {rows.map((row, ri) => (
            <div key={ri} ref={(el) => { rowRefs.current[ri] = el; }} className="grid gap-0" style={{ gridTemplateColumns: `repeat(${row.cols}, minmax(0, 1fr))` }}>
              {row.bars.map((bi) => {
                const bar = bars[bi];
                return (
                  <div
                    key={bi}
                    data-bar={bi}
                    className="relative grid border-l-2 border-gray-500"
                    style={{ gridColumn: `span ${bar.cells.length}`, gridTemplateColumns: `repeat(${bar.cells.length}, minmax(0, 1fr))` }}
                  >
                    <span className="absolute -top-0.5 left-1 right-1 flex items-baseline gap-1 text-[9px] text-gray-500 pointer-events-none whitespace-nowrap overflow-hidden">
                      {bi + 1}
                      {bar.label && <span className="truncate text-[10px] font-semibold text-amber-500">{bar.label}</span>}
                    </span>
                    {bar.cells.map((ci) => {
                      const placed = byCell.get(ci);
                      const isCursor = ci === cursor;
                      const isSelected = anchor !== null && ci >= rangeLo && ci <= rangeHi;
                      const isPlaying = ci === playIdx;
                      return (
                        <div
                          key={ci}
                          data-cell={ci}
                          onPointerDown={onCellDown(ci)}
                          className={`relative h-11 flex items-end px-1 pb-1.5 border-r border-dashed border-gray-700 cursor-text select-none ${
                            isCursor ? 'bg-blue-900/40' : isSelected ? 'bg-blue-500/15' : 'hover:bg-gray-800/40'
                          } ${isPlaying ? 'shadow-[inset_0_-3px_0_0_rgb(251,191,36)]' : ''}`}
                        >
                          {isCursor ? (
                            <input
                              ref={inputRef}
                              autoFocus
                              value={buffer}
                              onChange={(e) => {
                                setBuffer(e.target.value);
                                setError(null);
                                setAnchor(null);
                              }}
                              onKeyDown={onKeyDown}
                              spellCheck={false}
                              autoCapitalize="off"
                              autoCorrect="off"
                              autoComplete="off"
                              aria-label={`Chord at bar ${bi + 1}, beat ${ci - bar.cells[0] + 1}`}
                              className={`absolute inset-0 w-full bg-transparent px-1 pt-3 text-sm font-mono outline-none ${
                                error ? 'text-red-400' : 'text-white'
                              } ${buffer ? '' : 'caret-blue-400'}`}
                            />
                          ) : null}
                          {placed && !(isCursor && buffer) && (
                            <span
                              className={`relative text-sm font-semibold whitespace-nowrap truncate pointer-events-none ${
                                isPlaying ? 'text-amber-300' : 'text-gray-100'
                              }`}
                              title={placed.offGrid ? 'Off the grid since the tapMap changed' : placed.push ? 'Pushed: comes in on the "and" before' : undefined}
                            >
                              {placed.push && <span className="text-amber-400 mr-px">›</span>}
                              {placed.chord.symbol}
                              {placed.offGrid && <span className="ml-0.5 text-orange-400">•</span>}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-[1.5rem] px-3 md:px-5 pb-1 text-xs">
        {error ? (
          <span className="text-red-400">{error}. Esc to clear.</span>
        ) : lastTyped ? (
          <span className="text-gray-500">
            <span className="font-mono">{lastTyped.typed}</span> saved as <span className="text-gray-200 font-semibold">{lastTyped.stored}</span>
          </span>
        ) : (
          <span className="text-gray-600">Sloppy spellings are fine: am7, c-7, bbmaj7, f#ø, d/f#, nc</span>
        )}
      </div>

      {desktop && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
          <span><Kbd>Space</Kbd> next beat</span>
          <span><Kbd>Tab</Kbd> next bar</span>
          <span><Kbd>⇧</Kbd> back</span>
          <span><Kbd>/</Kbd> repeat last chord</span>
          <span><Kbd>%</Kbd> copy previous bar</span>
          <span><Kbd>&lt;</Kbd> push to the &quot;and&quot;</span>
          <span><Kbd>⌫</Kbd> delete</span>
          <span><Kbd>⇧click</Kbd> select</span>
          <span><Kbd>⌘C</Kbd> <Kbd>⌘X</Kbd> <Kbd>⌘V</Kbd> copy, cut, paste</span>
          <span><Kbd>⌘↵</Kbd> play from here</span>
          <span><Kbd>⌘Z</Kbd> undo</span>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">{children}</kbd>;
}

/** Chords where there's no grid (before the first tap, after the last). */
function FreeTimeList({ chords, onStamp }: { chords: ChordEvent[]; onStamp?: () => void }) {
  if (chords.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-gray-500">
      <span className="italic">Free time:</span>
      {chords.map((c) => (
        <span key={c.time}>
          <span className="font-semibold text-gray-200">{c.symbol}</span> <span className="font-mono">{formatPrecise(c.time)}</span>
        </span>
      ))}
      {onStamp && (
        <button type="button" className="underline hover:text-gray-300" onClick={onStamp}>edit in Stamp</button>
      )}
    </div>
  );
}
