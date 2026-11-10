import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useFlash } from '../../hooks/useFlash';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useChordsEditorStore } from '../../store/chordsEditorStore';
import { beatGrid, cellFor, isFreeTime, isOffGrid, snapTime, type GridLine, type Snap } from '../../audio/chordGrid';
import { chordsFromText, normalizeChord } from '../../audio/chordSymbols';
import { TapPadButton } from '../ui/TapPadButton';
import { formatPrecise } from './time';

const NUDGE = 0.05;
/** Replay starts this many seconds before the chord. */
const REPLAY_LEAD = 1;

const SNAP_OPTIONS: { value: Snap; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'beat', label: 'Beat' },
  { value: 'half', label: '½' },
  { value: 'quarter', label: '¼' },
];

/** "5.3" (bar 5, beat 3), "›5.1" for a push, or "free" where there's no grid. */
function barBeat(t: number, grid: GridLine[]): string {
  const cell = cellFor(t, grid);
  if (!cell) return 'free';
  let bar = 0;
  let barStart = 0;
  for (let i = 0; i <= cell.index; i++) {
    if (grid[i].bar) {
      bar++;
      barStart = i;
    }
  }
  return `${cell.push ? '›' : ''}${Math.max(1, bar)}.${cell.index - barStart + 1}`;
}

/**
 * Stamp mode: for free time, songs without a tapMap, or just feel. Type the
 * chords to place into the queue, play, and press Tab as each one starts;
 * Shift+Tab takes the last one back. Stamps snap to the grid you pick,
 * never in free time. Chords already on the grid
 * aren't touched.
 */
export function ChordsStampPane() {
  const engine = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const timeSignatureMap = useSongStore((s) => s.selectedSong?.timeSignatureMap);
  const coarse = useMediaQuery('(pointer: coarse)');
  const {
    chords, queue, stamped, selected, snap,
    setQueue, stamp, takeBack, nudge, select, applyEdit, setSnap, undo, redo,
  } = useChordsEditorStore();
  const grid = useMemo(() => beatGrid(tapMap, timeSignatureMap), [tapMap, timeSignatureMap]);

  const [text, setText] = useState('');
  const [bad, setBad] = useState<string[]>([]);
  /** The first chord (time) of a Shift-clicked range; `selected` is the other end. */
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null);
  const rangeTimes = useMemo(() => {
    if (rangeAnchor === null || selected === null) return [];
    const lo = Math.min(rangeAnchor, selected);
    const hi = Math.max(rangeAnchor, selected);
    return chords.filter((c) => c.time >= lo && c.time <= hi).map((c) => c.time);
  }, [rangeAnchor, selected, chords]);
  const { active: pressed, flash } = useFlash();
  const rowRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

  const addToQueue = () => {
    const raw = chordsFromText(text);
    const good: string[] = [];
    const rejected: string[] = [];
    for (const r of raw) {
      const n = normalizeChord(r);
      if (n) good.push(n);
      else rejected.push(r);
    }
    setQueue([...queue, ...good]);
    setBad(rejected);
    if (rejected.length === 0) setText('');
  };

  // Read the engine clock directly so the stamp matches the keypress or
  // finger-down, not the last UI tick.
  const stampNext = useCallback(() => {
    stamp(snapTime(engine.clock.currentTime, grid, snap));
  }, [engine, stamp, grid, snap]);

  const replay = useCallback(() => {
    if (selected === null) return;
    engine.seek(Math.max(0, selected - REPLAY_LEAD));
    if (!playing) engine.play();
  }, [selected, engine, playing]);

  const remove = useCallback(() => {
    if (rangeTimes.length > 0) applyEdit(rangeTimes, [], null);
    else if (selected !== null) applyEdit([selected], [], null);
    setRangeAnchor(null);
  }, [rangeTimes, selected, applyEdit]);

  // Keys. Space (play/pause) is the transport bar's. Typing in the queue box is left alone.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) { takeBack(); flash('back'); } else { stampNext(); flash('stamp'); }
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (selected !== null) nudge(selected, e.key === 'ArrowLeft' ? -NUDGE : NUDGE);
        flash(e.key === 'ArrowLeft' ? 'nudge-' : 'nudge+');
      } else if (!mod && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        replay();
        flash('replay');
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove();
      } else if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && (e.key === 'a' || e.key === 'A') && chords.length > 0) {
        e.preventDefault();
        setRangeAnchor(chords[0].time);
        select(chords[chords.length - 1].time);
      } else if (e.key === 'Escape') {
        setRangeAnchor(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stampNext, takeBack, nudge, selected, replay, remove, undo, redo, flash, chords, select]);

  useEffect(() => {
    if (selected !== null) rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const next = queue[0];
  const btn = 'rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-sm text-gray-300 transition-[background-color,filter,transform] duration-75';
  const lit = (id: string) => (pressed === id ? 'brightness-150 scale-[0.97]' : '');
  const kbd = (k: string) => <span className="ml-1 font-mono text-xs opacity-60">({k})</span>;
  const stampLabel = next ? `Stamp ${next}` : 'Queue is empty';
  const lastStamped = stamped.length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="max-w-2xl w-full mx-auto px-3 md:px-0 space-y-2">
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addToQueue();
              }
            }}
            placeholder="Chords to place, in order: G Em7 C D, or paste a ChordPro sheet"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="flex-1 min-w-0 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-500"
          />
          <button type="button" className={`${btn} px-3 py-1.5`} onClick={addToQueue} disabled={!text.trim()}>
            Add
          </button>
        </div>
        {bad.length > 0 && (
          <p className="text-xs text-red-400">Not chord names I know: {bad.join(', ')}. Fix them and press Add again.</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 min-h-[1.75rem]">
          <span className="text-xs text-gray-500">Queue:</span>
          {queue.length === 0 && <span className="text-xs text-gray-600">empty</span>}
          {queue.map((q, i) => (
            <span
              key={`${q}-${i}`}
              className={`rounded px-2 py-0.5 text-sm font-semibold ${i === 0 ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300'}`}
            >
              {q}
            </span>
          ))}
          {queue.length > 0 && (
            <button type="button" className="text-xs text-gray-500 underline hover:text-gray-300" onClick={() => setQueue([])}>
              clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex-1 min-h-[7rem] overflow-y-auto max-w-2xl w-full mx-auto rounded-lg border border-gray-700">
        {chords.length === 0 && <p className="p-4 text-sm text-gray-500">No chords yet. Add some to the queue, play, and stamp them.</p>}
        {chords.map((c) => {
          const inRange = rangeTimes.includes(c.time);
          const isSel = selected === c.time || inRange;
          const off = isOffGrid(c.time, grid);
          return (
            <div
              key={c.time}
              ref={(el) => { rowRefs.current.set(c.time, el); }}
              data-chord-row={c.time}
              onClick={(e) => {
                // Shift+click selects every chord from the last one clicked to here.
                if (e.shiftKey && selected !== null) {
                  setRangeAnchor((a) => (a === null ? selected : a));
                  select(c.time);
                  return;
                }
                setRangeAnchor(null);
                select(c.time);
                engine.seek(c.time);
              }}
              className={`flex items-center gap-3 px-3 py-2 md:py-1.5 border-l-2 cursor-pointer select-none transition-colors ${
                inRange ? 'bg-blue-500/15 border-blue-400/70' : isSel ? 'bg-gray-800/60 border-yellow-500/70' : 'border-transparent hover:bg-gray-800/30'
              }`}
            >
              <span className="w-16 text-right text-xs font-mono text-gray-500">{formatPrecise(c.time)}</span>
              <span className={`w-12 text-xs font-mono ${isFreeTime(c.time, grid) ? 'italic text-gray-600' : 'text-gray-500'}`}>
                {barBeat(c.time, grid)}
              </span>
              <span className="flex-1 min-w-0 truncate text-base md:text-sm font-semibold text-gray-100">{c.symbol}</span>
              {off && <span className="text-xs text-orange-400" title="Off the grid since the tapMap changed">off grid</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-3 max-w-2xl w-full mx-auto px-3 md:px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Snap</span>
          <div className="inline-flex rounded bg-gray-800 p-0.5" role="radiogroup" aria-label="Snap stamps to">
            {SNAP_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={snap === o.value}
                onClick={() => setSnap(o.value)}
                className={`px-2.5 py-0.5 rounded text-xs ${snap === o.value ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-600">{grid.length === 0 ? 'No tapMap: nothing to snap to' : 'Never in free time'}</span>
        </div>

        {coarse ? (
          <>
            <TapPadButton label={stampLabel} color="bg-cyan-500 text-gray-900" onFire={stampNext} disabled={!next} />
            <div className="grid grid-cols-4 gap-2">
              <button className={`${btn} py-2.5`} onClick={takeBack} disabled={!lastStamped}>Take back</button>
              <button className={`${btn} py-2.5`} onClick={() => selected !== null && nudge(selected, -NUDGE)} disabled={selected === null}>−0.05s</button>
              <button className={`${btn} py-2.5`} onClick={() => selected !== null && nudge(selected, NUDGE)} disabled={selected === null}>+0.05s</button>
              <button className={`${btn} py-2.5`} onClick={replay} disabled={selected === null}>Replay</button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`px-4 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium text-gray-900 transition-[background-color,filter,transform] duration-75 ${lit('stamp')}`}
              onClick={() => stampNext()}
              disabled={!next}
              title="Place the next chord in the queue at the playhead"
            >
              {stampLabel}{next && kbd('Tab')}
            </button>
            <button className={`${btn} px-3 py-1.5 ${lit('back')}`} onClick={takeBack} disabled={!lastStamped}>
              Take back{kbd('⇧Tab')}
            </button>
            <button className={`${btn} px-3 py-1.5 ${lit('nudge-')}`} onClick={() => selected !== null && nudge(selected, -NUDGE)} disabled={selected === null}>
              −0.05s{kbd('⌥←')}
            </button>
            <button className={`${btn} px-3 py-1.5 ${lit('nudge+')}`} onClick={() => selected !== null && nudge(selected, NUDGE)} disabled={selected === null}>
              +0.05s{kbd('⌥→')}
            </button>
            <button className={`${btn} px-3 py-1.5 ${lit('replay')}`} onClick={replay} disabled={selected === null}>
              Replay{kbd('R')}
            </button>
            <button className={`${btn} px-3 py-1.5`} onClick={remove} disabled={selected === null}>
              {rangeTimes.length > 1 ? `Delete ${rangeTimes.length}` : 'Delete'}{kbd('⌫')}
            </button>
          </div>
        )}
      </div>

      {!coarse && (
        <div className="mt-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-5 py-2 text-[10px] text-gray-600 border-t border-gray-700">
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Space</kbd> play/pause</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">Tab</kbd> stamp next</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⇧Tab</kbd> take back</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌥←→</kbd> nudge</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">R</kbd> replay</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⇧click</kbd> select a range</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌫</kbd> delete</span>
          <span><kbd className="px-1 py-0.5 bg-gray-800 rounded text-gray-400">⌘Z</kbd> undo</span>
        </div>
      )}
    </div>
  );
}
