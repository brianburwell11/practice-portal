import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { displayChord } from '../../audio/chordSymbols';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useChordsStore, LOOK_AHEAD_OPTIONS } from '../../store/chordsStore';
import { usePanelMinimizeStore } from '../../store/panelMinimizeStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePanelShortcut } from '../../hooks/usePanelShortcut';
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
/** Height of the section-name row across the top, when the song has sections. */
const SECTION_ROW_PX = 14;
const SECTION_PX = 10;
const NOW_PX = 18;
const NEXT_PX = 14;
/** Gap kept between the current chord and the next one pushing it. */
const GAP_PX = 14;
/** Over this many seconds before it sounds, the next chord grows to full
 *  size. In time rather than px, so it's as quick at every look-ahead. */
const GROW_SEC = 0.3;
/** Phone: width of the fixed slot on the left that holds the current chord. */
const PHONE_SLOT_PX = 96;
/** Least space between two upcoming chord names. A chord that would land
 *  closer than this to the one before it shows as a tick instead. */
const MIN_LABEL_GAP_PX = 8;

/** Rough label width, for the push-off. Good enough for chord names. */
function labelWidth(symbol: string, px: number): number {
  return symbol.length * px * 0.62 + 10;
}

/** Rough width of an uppercase section name at SECTION_PX. */
function sectionWidth(label: string): number {
  return label.length * SECTION_PX * 0.72 + 10;
}

/**
 * Which upcoming chords get a name (true) and which a tick (false). The first
 * one, the next chord, always gets a name; after that a chord is named only
 * when it clears the last named one by MIN_LABEL_GAP_PX, so zooming out thins
 * the names instead of piling them up. The first is measured at `firstPx`
 * (its full size, on desktop) so its growing in doesn't change which show.
 */
function namedChords(upcoming: ChordEvent[], x: (t: number) => number, firstPx: number, restPx: number): boolean[] {
  let right = -Infinity;
  return upcoming.map((c, i) => {
    const left = x(c.time);
    if (i > 0 && left < right + MIN_LABEL_GAP_PX) return false;
    right = left + labelWidth(c.symbol, i === 0 ? firstPx : restPx);
    return true;
  });
}

interface Section {
  time: number;
  label: string;
}

/**
 * The chord lane: a now / next strip under the waveform, below the notes and
 * above the lyrics. Upcoming chords scroll in from the right at a constant
 * speed, spaced by time, so the gap to the next chord shows how long is left.
 * Faint beat and bar lines come from the tapMap; there are none in free time.
 *
 * Desktop lines up with the lyrics (`PinnedLane`). Phones have no room left
 * of the waveform and stack lyrics vertically, so the lane gets its own slot
 * (`SlotLane`), shown when the transport's chords button is on. Hidden when
 * the song has no chords.
 */
export function ChordLane({ overrideChords }: { overrideChords?: ChordEvent[] }) {
  const storeChords = useChordsStore((s) => s.chords);
  const desktopMinimized = usePanelMinimizeStore((s) =>
    s.items.some((x) => x.kind === 'panel' && x.id === 'chords'),
  );
  const mobileVisible = useChordsStore((s) => s.mobileVisible);
  // The chords editor previews its draft here, minimized or toggled off or not.
  const chords = overrideChords ?? storeChords;
  // `k` shows or hides the chords on desktop (`c` is the loop). Off while
  // the chords editor previews here, since that shows regardless.
  const isDesktop = useMediaQuery('(min-width: 768px)');
  usePanelShortcut('k', 'chords', isDesktop && !overrideChords && chords.length > 0);
  if (chords.length === 0) return null;
  return (
    <>
      {(overrideChords || !desktopMinimized) && <PinnedLane chords={chords} className="hidden md:block" />}
      {(overrideChords || mobileVisible) && <SlotLane chords={chords} className="md:hidden" />}
    </>
  );
}

interface LaneProps {
  chords: ChordEvent[];
  className?: string;
}

/** What every lane needs each frame. `viewTime`, when set, lays the lane
 *  out as if playback were there (a lane scrolled by hand). */
function useLaneState(chords: ChordEvent[], viewTime: number | null = null) {
  const playhead = useTransportStore((s) => s.position);
  const position = viewTime ?? playhead;
  const lookAhead = useChordsStore((s) => s.lookAhead);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const timeSignatureMap = useSongStore((s) => s.selectedSong?.timeSignatureMap);
  const grid = useMemo(() => beatGrid(tapMap, timeSignatureMap), [tapMap, timeSignatureMap]);
  const sections = useMemo<Section[]>(
    () => (tapMap ?? [])
      .filter((e) => e.type === 'section' && e.label)
      .map((e) => ({ time: e.time, label: e.label! }))
      .sort((a, b) => a.time - b.time),
    [tapMap],
  );

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
    sections,
    /** Chords sit below the section row when there is one. */
    chordTop: sections.length > 0 ? SECTION_ROW_PX : 0,
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

/**
 * Shift + scroll moves the lane by hand, like the lyrics: the lane holds the
 * time it was scrolled to (returned) until playback reaches it, playback
 * pauses, or a seek while paused. Null while following playback.
 */
function useShiftScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  pps: number,
): number | null {
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const ppsRef = useRef(pps);
  useEffect(() => { ppsRef.current = pps; }, [pps]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const from = useTransportStore.getState().position;
      setHeldAt((t) => Math.max(0, (t ?? from) + delta / ppsRef.current));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  // Let go when playback catches up, on pause, or on a seek while paused.
  useEffect(() => {
    if (heldAt === null) return;
    return useTransportStore.subscribe((s, prev) => {
      const reached = s.playing && s.position >= heldAt;
      const paused = prev.playing && !s.playing;
      const seekedWhilePaused = !s.playing && !prev.playing && s.position !== prev.position;
      if (reached || paused || seekedWhilePaused) setHeldAt(null);
    });
  }, [heldAt]);

  return heldAt;
}

/**
 * Cmd + scroll, a trackpad pinch (the browser sends that as a scroll with
 * ctrlKey) or a two-finger pinch on a touch screen zooms the lane by changing
 * the look-ahead. The reading point stays put, so the lane zooms about the
 * current chord. Touch events, like the sheet music, so one finger still
 * scrolls the page. Returns whether a touch pinch is under way.
 */
function useLaneZoom(containerRef: React.RefObject<HTMLElement | null>): boolean {
  const [pinching, setPinching] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      // Line-mode wheels (Firefox) report a few lines, not pixels.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // Proportional, so a pinch's many small steps feel smooth; capped per
      // event, so a mouse wheel's big notches match the waveform's.
      const factor = Math.max(0.87, Math.min(1.15, Math.exp(dy * 0.01)));
      const { lookAhead, setLookAhead } = useChordsStore.getState();
      setLookAhead(lookAhead * factor);
    };

    let startDist = 0;
    let startLookAhead = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = dist(e.touches);
      startLookAhead = useChordsStore.getState().lookAhead;
      setPinching(true);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const d = dist(e.touches);
      // Fingers apart zooms in: fewer seconds across the lane.
      if (d > 0) useChordsStore.getState().setLookAhead(startLookAhead * (startDist / d));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (startDist && e.touches.length < 2) {
        startDist = 0;
        setPinching(false);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef]);
  return pinching;
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
 * Section names along the top of the lane: each upcoming one scrolls in with
 * a faint line at its start, and the current one stays put at `pinX` until
 * the next pushes it off to the left. Clicking one plays from it.
 */
function SectionMarks({
  sections, position, x, pinX, to, onSeek,
}: {
  sections: Section[];
  position: number;
  x: (t: number) => number;
  pinX: number;
  to: number;
  onSeek: (t: number) => void;
}) {
  if (sections.length === 0) return null;
  const cur = lastAtOrBefore(sections, position);
  const marks: ReactNode[] = [];
  for (let i = Math.max(0, cur); i < sections.length; i++) {
    const s = sections[i];
    const nextX = i + 1 < sections.length ? x(sections[i + 1].time) : Infinity;
    let left: number;
    if (i === cur) {
      left = Math.min(pinX, nextX - sectionWidth(s.label) - GAP_PX);
    } else {
      left = x(s.time);
      if (left > to) break;
      marks.push(
        <div
          key={`line-${s.time}`}
          className="absolute inset-y-0 left-0 w-px bg-amber-400/30 pointer-events-none"
          style={{ transform: `translateX(${left}px)` }}
        />,
      );
    }
    marks.push(
      <button
        key={`label-${s.time}`}
        type="button"
        onClick={() => onSeek(s.time)}
        title={`Play from ${s.label}`}
        className={`absolute top-0 left-0 flex items-center whitespace-nowrap uppercase tracking-wide font-semibold hover:text-amber-200 ${
          i === cur ? 'text-amber-400' : 'text-amber-400/70'
        }`}
        style={{ height: SECTION_ROW_PX, fontSize: SECTION_PX, paddingLeft: 3, transform: `translateX(${left}px)` }}
      >
        {s.label}
      </button>,
    );
  }
  return <>{marks}</>;
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
  const lookAhead = useChordsStore((s) => s.lookAhead);
  const hit = readingX - LABEL_INSET_PX;
  const pps = Math.max(20, (width - hit) / lookAhead);
  const heldAt = useShiftScroll(containerRef, pps);
  useLaneZoom(containerRef);
  const { position, grid, cur, prev, next, upcoming, sections, chordTop } = useLaneState(chords, heldAt);
  const x = (t: number) => hit + (t - position) * pps;
  const named = namedChords(upcoming, x, NOW_PX, NEXT_PX);

  const curX = cur && next ? Math.min(hit, x(next.time) - labelWidth(cur.symbol, NOW_PX) - GAP_PX) : hit;
  const prevX = prev ? Math.min(hit, curX) - labelWidth(prev.symbol, NOW_PX) - GAP_PX : 0;

  return (
    <div className={`relative ${className ?? ''}`}>
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={{
          height: LANE_HEIGHT + chordTop,
          maskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 120px), transparent calc(100% - 40px))',
          WebkitMaskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 120px), transparent calc(100% - 40px))',
        }}
      >
        {width > 0 && (
          <>
            <BeatLines grid={grid} position={position} x={x} from={hit} to={width} />
            <SectionMarks sections={sections} position={position} x={x} pinX={hit} to={width} onSeek={seek} />
            {prev && (
              <ChordLabel chord={prev} left={prevX} top={chordTop} px={NOW_PX} tone="past" onSeek={seek} />
            )}
            {upcoming.map((c, i) => {
              const cx = x(c.time);
              if (!named[i]) return <ChordTick key={c.time} chord={c} left={cx} top={chordTop} />;
              const grow = c === next ? Math.max(0, Math.min(1, 1 - (cx - hit) / (GROW_SEC * pps))) : 0;
              return (
                <ChordLabel
                  key={c.time}
                  chord={c}
                  left={cx}
                  top={chordTop}
                  px={NEXT_PX}
                  scale={1 + grow * (NOW_PX / NEXT_PX - 1)}
                  tone={grow > 0.3 ? 'arriving' : 'upcoming'}
                  marker
                  onSeek={seek}
                />
              );
            })}
            {cur && <ChordLabel chord={cur} left={curX} top={chordTop} px={NOW_PX} tone="now" marker onSeek={seek} />}
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
  const pinching = useLaneZoom(containerRef);
  const { position, lookAhead, grid, cur, upcoming, sections, chordTop } = useLaneState(chords);
  const curSection = sections[lastAtOrBefore(sections, position)] ?? null;

  const hit = PHONE_SLOT_PX;
  const pps = Math.max(20, (width - hit) / lookAhead);
  const x = (t: number) => hit + (t - position) * pps;
  const named = namedChords(upcoming, x, NEXT_PX, NEXT_PX);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className ?? ''}`} style={{ height: LANE_HEIGHT + chordTop }}>
      {width > 0 && (
        <>
          <BeatLines grid={grid} position={position} x={x} from={hit} to={width} />
          {/* The current section shows in the slot, so only later ones scroll here. */}
          <SectionMarks
            sections={sections.filter((s) => s.time > position)}
            position={position}
            x={x}
            pinX={hit}
            to={width}
            onSeek={seek}
          />
          {upcoming.map((c, i) => (named[i]
            ? <ChordLabel key={c.time} chord={c} left={x(c.time)} top={chordTop} px={NEXT_PX} tone="upcoming" marker onSeek={seek} />
            : <ChordTick key={c.time} chord={c} left={x(c.time)} top={chordTop} />
          ))}
        </>
      )}
      {/* No look-ahead button here, so show the value while pinching. */}
      {pinching && (
        <div
          data-pinch-readout
          className="absolute top-1 right-1 z-10 rounded bg-gray-900/90 px-1.5 text-[11px] tabular-nums text-gray-200 pointer-events-none"
        >
          {Math.round(lookAhead)}s ahead
        </div>
      )}
      <div
        className="absolute inset-y-0 left-0 flex items-center justify-end bg-gray-50/5 border-r-2 border-amber-400/70 pr-2"
        style={{ width: PHONE_SLOT_PX, paddingTop: chordTop }}
      >
        {curSection && (
          <button
            type="button"
            onClick={() => seek(curSection.time)}
            title={`Play from ${curSection.label}`}
            className="absolute top-0 left-1.5 right-2 truncate text-left uppercase tracking-wide font-semibold text-amber-400"
            style={{ height: SECTION_ROW_PX, fontSize: SECTION_PX, lineHeight: `${SECTION_ROW_PX}px` }}
          >
            {curSection.label}
          </button>
        )}
        {cur && (
          <button
            type="button"
            onClick={() => seek(cur.time)}
            className="font-semibold text-gray-100 whitespace-nowrap truncate"
            style={{ fontSize: NOW_PX }}
          >
            {displayChord(cur.symbol)}
          </button>
        )}
      </div>
    </div>
  );
}

type Tone = 'now' | 'arriving' | 'upcoming' | 'past';

const TONE_CLASS: Record<Tone, string> = {
  now: 'text-gray-100 font-semibold border-amber-400/70',
  // Only the current chord shows its line; the others keep the border's
  // space (transparent) so their text still lands on the reading point.
  arriving: 'text-gray-100 font-semibold border-transparent',
  upcoming: 'text-gray-400 font-medium border-transparent',
  past: 'text-gray-600 font-semibold border-transparent',
};

function ChordLabel({
  chord, left, top = 0, px, scale = 1, tone, marker = false, onSeek,
}: {
  chord: ChordEvent;
  left: number;
  /** Space above the label (the section row). */
  top?: number;
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
      title={`Play from ${displayChord(chord.symbol)}`}
      className={`absolute bottom-0 left-0 flex items-center whitespace-nowrap hover:text-gray-50 ${marker ? 'border-l-2' : ''} ${TONE_CLASS[tone]}`}
      style={{ top, transform: `translateX(${left}px)`, paddingLeft: marker ? LABEL_INSET_PX - 2 : 0 }}
    >
      <span className="inline-block origin-left" style={{ fontSize: px, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
        {displayChord(chord.symbol)}
      </span>
    </button>
  );
}

/** A chord with no room for its name: a short mark where it starts. */
const TICK_PX = 12;
function ChordTick({ chord, left, top = 0 }: { chord: ChordEvent; left: number; top?: number }) {
  return (
    <div
      data-chord-tick
      title={displayChord(chord.symbol)}
      className="absolute left-0 w-0.5 rounded-full bg-gray-500"
      // Centered on the chord names' line, below the section row.
      style={{ top: top + (LANE_HEIGHT - TICK_PX) / 2, height: TICK_PX, transform: `translateX(${left}px)` }}
    />
  );
}

/** Look-ahead and minimize, top right, like the lyrics' minimize button. */
function LaneControls() {
  const lookAhead = useChordsStore((s) => s.lookAhead);
  const setLookAhead = useChordsStore((s) => s.setLookAhead);
  // Steps to the next preset up from wherever zooming left it, then wraps.
  const cycle = () => {
    setLookAhead(LOOK_AHEAD_OPTIONS.find((o) => o > lookAhead + 0.5) ?? LOOK_AHEAD_OPTIONS[0]);
  };
  const shown = Math.round(lookAhead);
  return (
    <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
      <button
        type="button"
        onClick={cycle}
        className="rounded px-1 text-[11px] tabular-nums text-gray-500 hover:bg-gray-800 hover:text-gray-200"
        title="How far ahead the chords show (Cmd + scroll or pinch on the lane to zoom)"
        aria-label={`Show chords ${shown} seconds ahead`}
      >
        {shown}s
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
