import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import { secondsToBeat, buildBeatTimes, type WiggleConfig, type BeatTime } from './wiggleSync';
import { findCursorIdx, cardStyle, Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

type Mode = 'karaoke' | 'window' | 'trainTrack' | 'hybrid';

/**
 * Widget 5 — Four tracking modes side-by-side, all in sync.
 *
 *   karaoke     — playhead is fixed at 35% of viewport, score scrolls under it
 *   window      — playhead moves across a static window of N bars; window jumps
 *                 to the next page of N bars when the playhead hits the edge
 *   trainTrack  — like window, but each page also shows a grayed half-bar tail
 *                 of the previous page at the left and an ungrayed half-bar
 *                 preview of the next page at the right. On advance, the
 *                 right-preview becomes the first bar of the new page (the
 *                 "cartoon train" illusion of continuous tracks)
 *   hybrid      — like window, but the window starts scrolling smoothly when
 *                 the playhead enters a "follow zone" near either edge (~15%
 *                 of the window width on each side)
 *
 * The N-bars slider controls how much music is visible in the
 * window/trainTrack/hybrid modes. Karaoke ignores it.
 */
export function TrackingModeComparator({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [karaokeTl, setKaraokeTl] = useState<InfiniteBeatStamp[]>([]);
  const [windowTl, setWindowTl] = useState<InfiniteBeatStamp[]>([]);
  const [trainTl, setTrainTl] = useState<InfiniteBeatStamp[]>([]);
  const [hybridTl, setHybridTl] = useState<InfiniteBeatStamp[]>([]);
  const [windowBars, setWindowBars] = useState(4);
  const karaokeHostRef = useRef<HTMLDivElement | null>(null);
  const windowHostRef = useRef<HTMLDivElement | null>(null);
  const trainHostRef = useRef<HTMLDivElement | null>(null);
  const hybridHostRef = useRef<HTMLDivElement | null>(null);
  const [windowAnchor, setWindowAnchor] = useState(0); // measure index of left edge in static window
  const [trainAnchor, setTrainAnchor] = useState(0);   // measure index of first main bar in trainTrack
  const [hybridAnchor, setHybridAnchor] = useState(0); // smoothly-tracked left-edge measure (float)
  const [karaokePlayheadPx, setKaraokePlayheadPx] = useState(0);
  const [windowPlayheadPx, setWindowPlayheadPx] = useState(0);
  const [trainPlayheadPx, setTrainPlayheadPx] = useState(0);
  const [trainGrayPx, setTrainGrayPx] = useState(0);  // width of the grayed tail at the left
  const [trainGrayRightStartPx, setTrainGrayRightStartPx] = useState<number | null>(null);  // viewport-x where the right grayed region starts
  const [hybridPlayheadPx, setHybridPlayheadPx] = useState(0);
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);

  const handleK = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) karaokeHostRef.current = osmd.container.parentElement;
  }, []);
  const handleW = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) windowHostRef.current = osmd.container.parentElement;
  }, []);
  const handleT = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) trainHostRef.current = osmd.container.parentElement;
  }, []);
  const handleH = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) hybridHostRef.current = osmd.container.parentElement;
  }, []);

  // Helpers: measure-index → cursor x (first cursor step in that measure)
  const measureX = useCallback((tl: InfiniteBeatStamp[], measureIdx: number): number => {
    const stamp = tl.find((s) => s.measureIndex === Math.floor(measureIdx));
    if (!stamp) return 0;
    const next = tl.find((s) => s.measureIndex === Math.floor(measureIdx) + 1);
    if (!next) return stamp.xPx;
    const frac = measureIdx - Math.floor(measureIdx);
    return stamp.xPx + frac * (next.xPx - stamp.xPx);
  }, []);

  const cursorXAtBeat = useCallback((tl: InfiniteBeatStamp[], beat: number): number => {
    if (tl.length === 0) return 0;
    const idx = findCursorIdx(beat, tl);
    const stamp = tl[idx];
    const next = tl[idx + 1];
    if (!next) return stamp.xPx;
    const dBeat = next.absoluteBeat - stamp.absoluteBeat;
    if (dBeat <= 0) return stamp.xPx;
    const frac = Math.max(0, Math.min(1, (beat - stamp.absoluteBeat) / dBeat));
    return stamp.xPx + frac * (next.xPx - stamp.xPx);
  }, []);

  // Drive all three modes from the same audio time
  useEffect(() => {
    const scoreBeat = config ? secondsToBeat(currentTime + offsetSec, beatTimes, 120) : 0;

    // 1) KARAOKE — fixed playhead (35%), scroll the score
    const kHost = karaokeHostRef.current;
    if (kHost && karaokeTl.length > 0) {
      const xPx = cursorXAtBeat(karaokeTl, scoreBeat);
      kHost.scrollLeft = Math.max(0, xPx - kHost.clientWidth * 0.35);
      setKaraokePlayheadPx(0); // playhead is CSS-positioned, no need to track
    }

    // 2) WINDOW — show N bars, playhead moves; jump when it hits the right edge
    const wHost = windowHostRef.current;
    if (wHost && windowTl.length > 0) {
      const idx = findCursorIdx(scoreBeat, windowTl);
      const currentMeasure = windowTl[idx]?.measureIndex ?? 0;
      let anchor = windowAnchor;
      if (currentMeasure < anchor || currentMeasure >= anchor + windowBars) {
        // Page-jump: align anchor so currentMeasure is at the start of a window
        anchor = Math.floor(currentMeasure / windowBars) * windowBars;
        setWindowAnchor(anchor);
      }
      // Position scrollLeft so window's first measure is at viewport-x=0
      const leftX = measureX(windowTl, anchor);
      wHost.scrollLeft = leftX;
      // Playhead px relative to the visible viewport
      const cursorPx = cursorXAtBeat(windowTl, scoreBeat) - leftX;
      setWindowPlayheadPx(cursorPx);
    }

    // 3) TRAIN-TRACK — static N bars like `window`, but with a half-bar grayed
    //    tail at the left (context from previous page) and a half-bar ungrayed
    //    preview at the right (what's coming). On page advance the preview
    //    becomes the first bar of the new page — the cartoon "laying tracks
    //    ahead of yourself" effect.
    const tHost = trainHostRef.current;
    if (tHost && trainTl.length > 0) {
      const idx = findCursorIdx(scoreBeat, trainTl);
      const currentMeasure = trainTl[idx]?.measureIndex ?? 0;
      let anchor = trainAnchor;
      if (currentMeasure < anchor || currentMeasure >= anchor + windowBars) {
        anchor = Math.floor(currentMeasure / windowBars) * windowBars;
        setTrainAnchor(anchor);
      }
      const anchorX = measureX(trainTl, anchor);
      // Previous page's last bar — grayed half-bar width
      const prevBarStartX = anchor > 0 ? measureX(trainTl, anchor - 1) : anchorX;
      const prevBarWidth = anchor > 0 ? (anchorX - prevBarStartX) : 0;
      const halfPrev = prevBarWidth / 2;
      tHost.scrollLeft = Math.max(0, anchorX - halfPrev);
      setTrainGrayPx(halfPrev);
      // End of the main window in content coords: start of the measure after
      // the N-bar page. Convert to viewport coords; anything past that is the
      // next page and gets grayed so the reader sees where the snap will happen.
      const rightWindowEndX = measureX(trainTl, anchor + windowBars);
      setTrainGrayRightStartPx(rightWindowEndX - tHost.scrollLeft);
      const cursorPx = cursorXAtBeat(trainTl, scoreBeat) - tHost.scrollLeft;
      setTrainPlayheadPx(cursorPx);
    }

    // 4) HYBRID — playhead moves freely until it enters the follow zone, then
    //   the window scrolls to keep it inside the comfort zone
    const hHost = hybridHostRef.current;
    if (hHost && hybridTl.length > 0) {
      const cursorXAbs = cursorXAtBeat(hybridTl, scoreBeat);
      const viewportW = hHost.clientWidth;
      const leftXNow = measureX(hybridTl, hybridAnchor);
      const playheadPx = cursorXAbs - leftXNow;
      const followZone = 0.15; // 15% from each edge
      let nextAnchor = hybridAnchor;
      if (playheadPx > viewportW * (1 - followZone)) {
        // Push window forward smoothly
        const overshoot = playheadPx - viewportW * (1 - followZone);
        // Translate overshoot pixels into a measure delta via the local px-per-measure
        const localPxPerMeasure = estimateLocalPxPerMeasure(hybridTl, hybridAnchor);
        nextAnchor = hybridAnchor + overshoot / localPxPerMeasure;
      } else if (playheadPx < viewportW * followZone && hybridAnchor > 0) {
        const undershoot = viewportW * followZone - playheadPx;
        const localPxPerMeasure = estimateLocalPxPerMeasure(hybridTl, hybridAnchor);
        nextAnchor = Math.max(0, hybridAnchor - undershoot / localPxPerMeasure);
      }
      if (Math.abs(nextAnchor - hybridAnchor) > 0.001) {
        setHybridAnchor(nextAnchor);
      }
      const leftX = measureX(hybridTl, nextAnchor);
      hHost.scrollLeft = Math.max(0, leftX);
      setHybridPlayheadPx(cursorXAbs - leftX);
    }
  }, [currentTime, karaokeTl, windowTl, trainTl, hybridTl, beatTimes, config, windowBars, windowAnchor, trainAnchor, hybridAnchor, cursorXAtBeat, measureX, offsetSec]);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem 1.4rem', marginBottom: '0.6rem', fontSize: '0.85em' }}>
        <label>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
            Window size — <strong>{windowBars} bars</strong>
          </div>
          <input type="range" min={2} max={8} step={1} value={windowBars}
            onChange={(e) => { setWindowBars(parseInt(e.target.value)); setWindowAnchor(0); setTrainAnchor(0); }} style={{ width: '100%' }} />
        </label>
      </div>

      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => { seek(0); setWindowAnchor(0); setTrainAnchor(0); setHybridAnchor(0); }} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)}</span>
      </Toolbar>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <ModePane label="1 · Karaoke (fixed playhead, scrolling score)" desc="Default for our practice tool. Eyes never leave the playhead.">
          <InfiniteScrollRenderer url={scoreUrl} height={150} zoom={0.8}
            onReady={handleK} onTimeline={setKaraokeTl} />
          <FixedPlayhead leftFraction={0.35} />
        </ModePane>

        <ModePane label={`2 · Static window (${windowBars} bars, page-jump)`} desc="Window stays put, playhead crosses, then snap to the next page.">
          <InfiniteScrollRenderer url={scoreUrl} height={150} zoom={0.8}
            onReady={handleW} onTimeline={setWindowTl} />
          <MovingPlayhead leftPx={windowPlayheadPx} />
        </ModePane>

        <ModePane label={`3 · Train-track (${windowBars} bars + grayed prev/next)`} desc="Static like window, but with a grayed half-bar tail of the previous page on the left AND everything past the window grayed on the right. The right-gray boundary is where the page will snap — once the playhead crosses it, the window advances and what was gray becomes the next page's live content.">
          <InfiniteScrollRenderer url={scoreUrl} height={150} zoom={0.8}
            onReady={handleT} onTimeline={setTrainTl} />
          {/* Grayed tail of the previous page — fades the leftmost half-bar */}
          {trainGrayPx > 0 && (
            <div style={{
              position: 'absolute',
              top: 0, bottom: 30, left: 0,
              width: trainGrayPx,
              background: 'rgba(255,255,255,0.55)',
              pointerEvents: 'none', zIndex: 4,
              borderRight: '1px dashed rgba(107,159,214,0.4)',
            }} />
          )}
          {/* Grayed head of the next page — fades everything past the window */}
          {trainGrayRightStartPx != null && (
            <div style={{
              position: 'absolute',
              top: 0, bottom: 30,
              left: Math.max(0, trainGrayRightStartPx),
              right: 0,
              background: 'rgba(255,255,255,0.55)',
              pointerEvents: 'none', zIndex: 4,
              borderLeft: '1px dashed rgba(107,159,214,0.4)',
            }} />
          )}
          <MovingPlayhead leftPx={trainPlayheadPx} />
        </ModePane>

        <ModePane label="4 · Hybrid (window scrolls inside follow zone)" desc="Best of both — window stays still until the playhead hits the comfort-zone edge, then the window slides to keep it in view.">
          <InfiniteScrollRenderer url={scoreUrl} height={150} zoom={0.8}
            onReady={handleH} onTimeline={setHybridTl} />
          <MovingPlayhead leftPx={hybridPlayheadPx} />
          {/* Visualize the follow zone */}
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: '15%', width: 1, background: 'rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 30, left: '85%', width: 1, background: 'rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
        </ModePane>
      </div>

      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={currentTime}
        onChange={(e) => seek(parseFloat(e.target.value))}
        style={{ width: '100%', marginTop: 8 }}
      />
      <audio ref={audioRef} preload="metadata" src={audioUrl} style={{ display: 'none' }} />
    </div>
  );
}

function ModePane({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.78em', color: 'var(--accent, #6B9FD6)', marginBottom: 2, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.72em', color: 'var(--text-secondary)', marginBottom: 4 }}>{desc}</div>
      <div style={{ position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function FixedPlayhead({ leftFraction }: { leftFraction: number }) {
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 30,
      left: `${leftFraction * 100}%`,
      width: 2, background: 'rgba(217, 70, 239, 0.85)',
      pointerEvents: 'none', boxShadow: '0 0 8px rgba(217,70,239,0.6)', zIndex: 5,
    }} />
  );
}

function MovingPlayhead({ leftPx }: { leftPx: number }) {
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 30,
      left: leftPx,
      width: 2, background: 'rgba(217, 70, 239, 0.85)',
      pointerEvents: 'none', boxShadow: '0 0 8px rgba(217,70,239,0.6)', zIndex: 5,
      transition: 'left 60ms linear',
    }} />
  );
}

/** Estimate px-per-measure near the current anchor by looking at adjacent measures */
function estimateLocalPxPerMeasure(tl: InfiniteBeatStamp[], measureIdx: number): number {
  const m0 = Math.floor(measureIdx);
  const a = tl.find((s) => s.measureIndex === m0);
  const b = tl.find((s) => s.measureIndex === m0 + 1) ?? tl.find((s) => s.measureIndex === m0 - 1);
  if (!a || !b) return 200;
  return Math.abs(b.xPx - a.xPx) || 200;
}
