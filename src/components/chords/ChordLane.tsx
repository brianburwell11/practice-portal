import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useChordsStore, LOOK_AHEAD_OPTIONS } from '../../store/chordsStore';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';
import { beatGrid, lastAtOrBefore, type GridLine } from '../../audio/chordGrid';
import type { ChordEvent } from '../../audio/chordsTypes';

/** Pixels to nudge the reading point right of the waveform's left edge.
 *  Keep in sync with `LyricsDisplay.tsx`, `NotesLayer.tsx` and
 *  `ScrollingScore.tsx`: the current chord starts on the same vertical line
 *  as the current lyric. */
const FOCUS_LEFT_NUDGE_PX = 24;
/** A chord label's left border + padding. The marker line sits this far left
 *  of the reading point so the chord's *text* lines up with the lyric's. */
const LABEL_INSET_PX = 7;
const LANE_HEIGHT = 44;
const NOW_PX = 18;
const NEXT_PX = 14;
/** Gap kept between the current chord and the next one pushing it. */
const GAP_PX = 14;
/** Over this many px before the reading point, the next chord grows to full size. */
const GROW_PX = 70;
/** Phone: width of the fixed slot on the left that holds the current chord. */
const PHONE_SLOT_PX = 96;

/** Rough label width, for the push-off. Good enough for chord names. */
function labelWidth(symbol: string, px: number): number {
  return symbol.length * px * 0.62 + 10;
}

/**
 * The chord lane: a now / next strip under the waveform, below the notes and
 * above the lyrics. Upcoming chords scroll in from the right at a constant
 * speed, spaced by time, so the gap to the next chord shows how long is left.
 * Faint beat and bar lines come from the tapMap; there are none in free time.
 *
 * Desktop lines up with the lyrics (`PinnedLane`). Phones have no room left
 * of the waveform and stack lyrics vertically, so the lane gets its own slot
 * (`SlotLane`). Hidden when the song has no chords.
 */
export function ChordLane() {
  const chords = useChordsStore((s) => s.chords);
  const desktopMinimized = usePanelMinimizeStore((s) =>
    s.items.some((x) => x.kind === 'panel' && x.id === 'chords'),
  );
  if (chords.length === 0) return null;
  return (
    <>
      {!desktopMinimized && <PinnedLane chords={chords} className="hidden md:block" />}
      <SlotLane chords={chords} className="md:hidden" />
    </>
  );
}

interface LaneProps {
  chords: ChordEvent[];
  className?: string;
}

/** What every lane needs each frame. */
function useLaneState(chords: ChordEvent[]) {
  const position = useTransportStore((s) => s.position);
  const lookAhead = useChordsStore((s) => s.lookAhead);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const timeSignatureMap = useSongStore((s) => s.selectedSong?.timeSignatureMap);
  const grid = useMemo(() => beatGrid(tapMap, timeSignatureMap), [tapMap, timeSignatureMap]);

  const idx = lastAtOrBefore(chords, position);
  const upcoming: ChordEvent[] = [];
  for (let i = idx + 1; i < chords.length && chords[i].time <= position + lookAhead + 1; i++) upcoming.push(chords[i]);
  return {
    position,
    lookAhead,
    grid,
    cur: idx >= 0 ? chords[idx] : null,
    prev: idx >= 1 ? chords[idx - 1] : null,
    next: chords[idx + 1] ?? null,
    upcoming,
  };
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** The lyric reading point in `container`'s px, kept current on resize. */
function useReadingX(containerRef: React.RefObject<HTMLElement | null>): number {
  const [x, setX] = useState(0);
  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const waveformEl = document.querySelector('[data-waveform-timeline]') as HTMLElement | null;
      if (!waveformEl) {
        setX(container.offsetWidth * 0.22 + FOCUS_LEFT_NUDGE_PX);
        return;
      }
      const left = waveformEl.getBoundingClientRect().left - container.getBoundingClientRect().left;
      setX(Math.max(0, left) + FOCUS_LEFT_NUDGE_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    const waveformEl = document.querySelector('[data-waveform-timeline]');
    if (waveformEl) ro.observe(waveformEl);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef]);
  return x;
}

function BeatLines({ grid, position, x, from, to }: { grid: GridLine[]; position: number; x: (t: number) => number; from: number; to: number }) {
  const start = Math.max(0, lastAtOrBefore(grid, position));
  const lines: ReactNode[] = [];
  for (let i = start; i < grid.length; i++) {
    const lx = x(grid[i].time);
    if (lx > to) break;
    if (lx < from) continue;
    lines.push(
      <div
        key={grid[i].time}
        className={`absolute bottom-0 ${grid[i].bar ? 'top-0 w-0.5 bg-gray-800' : 'h-2.5 w-px bg-gray-800/70'}`}
        style={{ left: 0, transform: `translateX(${lx}px)` }}
      />,
    );
  }
  return <>{lines}</>;
}

/**
 * Desktop: the current chord's text starts on the lyric reading point, like
 * the current lyric. When the next chord gets close it pushes the current
 * one off to the left (a sticky header), growing to full size as it arrives;
 * its edge reaches the reading point exactly when it sounds. The previous
 * chord fades out to the left, like the previous lyric.
 */
function PinnedLane({ chords, className }: LaneProps) {
  const engine = useAudioEngine();
  const seek = (t: number) => engine.seek(t);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useWidth(containerRef);
  const readingX = useReadingX(containerRef);
  const { position, lookAhead, grid, cur, prev, next, upcoming } = useLaneState(chords);

  const hit = readingX - LABEL_INSET_PX;
  const pps = Math.max(20, (width - hit) / lookAhead);
  const x = (t: number) => hit + (t - position) * pps;

  const curX = cur && next ? Math.min(hit, x(next.time) - labelWidth(cur.symbol, NOW_PX) - GAP_PX) : hit;
  const prevX = prev ? Math.min(hit, curX) - labelWidth(prev.symbol, NOW_PX) - GAP_PX : 0;

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={{
          height: LANE_HEIGHT,
          maskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 120px), transparent calc(100% - 40px))',
          WebkitMaskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 120px), transparent calc(100% - 40px))',
        }}
      >
        {width > 0 && (
          <>
            <BeatLines grid={grid} position={position} x={x} from={hit} to={width} />
            {prev && (
              <ChordLabel chord={prev} left={prevX} px={NOW_PX} tone="past" onSeek={seek} />
            )}
            {upcoming.map((c) => {
              const cx = x(c.time);
              const grow = c === next ? Math.max(0, Math.min(1, 1 - (cx - hit) / GROW_PX)) : 0;
              return (
                <ChordLabel
                  key={c.time}
                  chord={c}
                  left={cx}
                  px={NEXT_PX}
                  scale={1 + grow * (NOW_PX / NEXT_PX - 1)}
                  tone={grow > 0.3 ? 'arriving' : 'upcoming'}
                  marker
                  onSeek={seek}
                />
              );
            })}
            {cur && <ChordLabel chord={cur} left={curX} px={NOW_PX} tone="now" marker onSeek={seek} />}
          </>
        )}
      </div>
      <LaneControls />
    </div>
  );
}

/**
 * Phone: the current chord sits in a fixed slot on the left, against the
 * line where chords take over; upcoming chords scroll in from the right and
 * replace it as they reach that line.
 */
function SlotLane({ chords, className }: LaneProps) {
  const engine = useAudioEngine();
  const seek = (t: number) => engine.seek(t);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useWidth(containerRef);
  const { position, lookAhead, grid, cur, upcoming } = useLaneState(chords);

  const hit = PHONE_SLOT_PX;
  const pps = Math.max(20, (width - hit) / lookAhead);
  const x = (t: number) => hit + (t - position) * pps;

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className ?? ''}`} style={{ height: LANE_HEIGHT }}>
      {width > 0 && (
        <>
          <BeatLines grid={grid} position={position} x={x} from={hit} to={width} />
          {upcoming.map((c) => (
            <ChordLabel key={c.time} chord={c} left={x(c.time)} px={NEXT_PX} tone="upcoming" marker onSeek={seek} />
          ))}
        </>
      )}
      <div
        className="absolute inset-y-0 left-0 flex items-center justify-end bg-white/5 border-r-2 border-amber-400/70 pr-2"
        style={{ width: PHONE_SLOT_PX }}
      >
        {cur && (
          <button
            type="button"
            onClick={() => seek(cur.time)}
            className="font-semibold text-gray-100 whitespace-nowrap truncate"
            style={{ fontSize: NOW_PX }}
          >
            {cur.symbol}
          </button>
        )}
      </div>
    </div>
  );
}

type Tone = 'now' | 'arriving' | 'upcoming' | 'past';

const TONE_CLASS: Record<Tone, string> = {
  now: 'text-gray-100 font-semibold border-amber-400/70',
  arriving: 'text-gray-100 font-semibold border-amber-400/70',
  upcoming: 'text-gray-400 font-medium border-gray-600',
  past: 'text-gray-600 font-semibold border-transparent',
};

function ChordLabel({
  chord, left, px, scale = 1, tone, marker = false, onSeek,
}: {
  chord: ChordEvent;
  left: number;
  px: number;
  scale?: number;
  tone: Tone;
  marker?: boolean;
  onSeek: (t: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSeek(chord.time)}
      title={`Play from ${chord.symbol}`}
      className={`absolute inset-y-0 left-0 flex items-center whitespace-nowrap hover:text-white ${marker ? 'border-l-2' : ''} ${TONE_CLASS[tone]}`}
      style={{ transform: `translateX(${left}px)`, paddingLeft: marker ? LABEL_INSET_PX - 2 : 0 }}
    >
      <span className="inline-block origin-left" style={{ fontSize: px, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
        {chord.symbol}
      </span>
    </button>
  );
}

/** Look-ahead and minimize, top right, like the lyrics' minimize button. */
function LaneControls() {
  const lookAhead = useChordsStore((s) => s.lookAhead);
  const setLookAhead = useChordsStore((s) => s.setLookAhead);
  const cycle = () => {
    const i = LOOK_AHEAD_OPTIONS.indexOf(lookAhead);
    setLookAhead(LOOK_AHEAD_OPTIONS[(i + 1) % LOOK_AHEAD_OPTIONS.length]);
  };
  return (
    <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
      <button
        type="button"
        onClick={cycle}
        className="rounded px-1 text-[11px] tabular-nums text-gray-500 hover:bg-gray-800 hover:text-gray-200"
        title="How far ahead the chords show"
        aria-label={`Show chords ${lookAhead} seconds ahead`}
      >
        {lookAhead}s
      </button>
      <button
        type="button"
        onClick={() => usePanelMinimizeStore.getState().minimizePanel('chords')}
        className="flex items-center justify-center rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
        title="Minimize chords"
        aria-label="Minimize chords"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="19" x2="19" y2="19" />
        </svg>
      </button>
    </div>
  );
}
