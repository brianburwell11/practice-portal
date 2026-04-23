import { useEffect, useRef, useState } from 'react';

export interface InfiniteBeatStamp {
  /** Sequential cursor position from osmd.cursor.next() walk */
  index: number;
  /** 0-based measure index */
  measureIndex: number;
  /** Quarter-note offset within the measure */
  beatInMeasure: number;
  /** Absolute quarter-note offset from start of score */
  absoluteBeat: number;
  /** Cursor element offsetLeft at this position (in render-pixels) */
  xPx: number;
  /** Width of the cursor bbox at this step (px). Used for "beat width". */
  widthPx: number;
}

interface Props {
  url: string;
  /** Fixed CSS height of the scrolling viewport */
  height?: number;
  /** OSMD zoom factor (1 = 100%) */
  zoom?: number;
  /** Equal-beat-width post-processing toggle */
  equalBeatWidth?: boolean;
  /**
   * Fraction of the viewport reserved as blank space *before* the first note
   * (and `1 - leadingPadFraction` after the last). Matches the fixed playhead's
   * leftFraction so beat 0 can actually sit under the playhead at t=0, and so
   * the final beat can reach the playhead at t=end. Default 0.35.
   */
  leadingPadFraction?: number;
  /** Notify parent when render completes; passes the OSMD instance */
  onReady?: (osmd: any) => void;
  /** Notify parent when the per-cursor-step timeline is built */
  onTimeline?: (timeline: InfiniteBeatStamp[]) => void;
  /**
   * Notify parent of the screen-x of each measure's *left barline* (not the
   * first-note-onset). Index by measureIndex. One entry per measure; a
   * synthetic trailing entry equals the score's right edge so callers can
   * treat it as a closed half-open interval `[measureXs[i], measureXs[i+1])`.
   */
  onMeasureXs?: (xs: number[]) => void;
  /**
   * Optional overlay rendered *inside* the scroll host, absolutely
   * positioned at (0,0) over the score. Children using x-values in
   * scroll-host content coordinates (what `onTimeline` / `onMeasureXs`
   * emit) scroll natively with the score.
   */
  overlay?: React.ReactNode;
  /** Internal render counter — bump to force a re-render without full reload */
  renderToken?: number;
}

/**
 * OSMD renderer configured for one continuous horizontal staffline. The whole
 * score is laid out on a single very-wide line; the host wrapper is the
 * horizontally-scrollable surface.
 *
 * Three knobs that matter for "single-line" mode:
 *  - drawingParameters: 'compacttight' — denser layout, less padding around systems
 *  - renderSingleHorizontalStaffline: true — disable line wrapping entirely (OSMD ≥ 1.6)
 *  - EngravingRules.NewSystemAtXMLNewSystemAttribute = false — ignore <print new-system> hints
 *  - EngravingRules.NewPageAtXMLNewPageAttribute = false — and page breaks
 *  - EngravingRules.SheetMaximumWidth — must be raised for long pieces (default 32767 SVG limit)
 */
export function InfiniteScrollRenderer({
  url,
  height = 220,
  zoom = 1.0,
  equalBeatWidth = false,
  leadingPadFraction = 0.35,
  onReady,
  onTimeline,
  onMeasureXs,
  overlay,
  renderToken = 0,
}: Props) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendering' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [scoreWidth, setScoreWidth] = useState<number | null>(null);

  // Initial load + render
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!containerRef.current) return;
      setStatus('loading');
      setError(null);
      try {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;

        if (osmdRef.current) {
          try { osmdRef.current.clear(); } catch (_) { /* ignore */ }
          osmdRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: false,
          backend: 'svg',
          drawTitle: false,           // titles waste vertical space in the strip
          drawSubtitle: false,
          drawComposer: false,
          drawPartNames: false,
          drawingParameters: 'compacttight',
          followCursor: false,
          renderSingleHorizontalStaffline: true,
        });

        // Hard-disable any layout breaks the source XML asks for, and bump
        // the SVG width cap so 90+ measures fit on one line.
        const er = osmd.EngravingRules;
        er.NewSystemAtXMLNewSystemAttribute = false;
        er.NewPageAtXMLNewPageAttribute = false;
        er.RenderSingleHorizontalStaffline = true;
        er.SheetMaximumWidth = 100000;
        // Padding so the first/last measure aren't flush against the edge
        er.PageLeftMargin = 2;
        er.PageRightMargin = 2;
        // Equal beat width: OSMD has an experimental flag that forces every
        // measure to the *largest* required width. It's not strictly equal
        // per-beat (a 7-note measure dictates the width, sparse measures pad),
        // but visually each beat takes a much more uniform amount of space.
        er.FixedMeasureWidth = !!equalBeatWidth;

        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
          return r.text();
        });
        if (cancelled) return;
        await osmd.load(text);

        osmd.zoom = zoom;

        setStatus('rendering');
        const t0 = performance.now();
        osmd.render();
        const dt = performance.now() - t0;
        if (cancelled) return;
        setRenderMs(dt);
        osmdRef.current = osmd;

        // Show cursor — required before offsetLeft is meaningful
        osmd.cursor.show();

        // Measure score width
        const svg = containerRef.current.querySelector('svg');
        if (svg) {
          const w = svg.getBoundingClientRect().width;
          setScoreWidth(w);
        }

        // Build per-step timeline (cursor x's are already correct for the
        // current layout — equal-beat-width applied via OSMD's own FixedMeasureWidth)
        const timeline = buildBeatTimeline(osmd, scrollHostRef.current);
        onTimeline?.(timeline);
        const measureXs = buildMeasureStartXs(osmd, scrollHostRef.current, timeline);
        onMeasureXs?.(measureXs);

        setStatus('ready');
        onReady?.(osmd);
      } catch (err) {
        if (cancelled) return;
        console.error('InfiniteScrollRenderer failed', err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, equalBeatWidth, renderToken]);

  // Live zoom updates without full re-load
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready') return;
    if (Math.abs(osmd.zoom - zoom) < 0.001) return;
    osmd.zoom = zoom;
    try {
      osmd.render();
      osmd.cursor.show();
      const svg = containerRef.current?.querySelector('svg');
      if (svg) setScoreWidth(svg.getBoundingClientRect().width);
      const tl = buildBeatTimeline(osmd, scrollHostRef.current);
      onTimeline?.(tl);
      const mxs = buildMeasureStartXs(osmd, scrollHostRef.current, tl);
      onMeasureXs?.(mxs);
    } catch (e) {
      console.warn('zoom re-render failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  return (
    <div>
      <div
        ref={scrollHostRef}
        style={{
          position: 'relative',
          height,
          overflowX: 'auto',
          overflowY: 'hidden',
          background: '#fff',
          borderRadius: 6,
          border: '1px solid var(--border)',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ display: 'inline-block', width: `${leadingPadFraction * 100}%`, height: 1, verticalAlign: 'top' }} aria-hidden />
        <div ref={containerRef} style={{ minHeight: height, display: 'inline-block', verticalAlign: 'top' }} />
        <div style={{ display: 'inline-block', width: `${(1 - leadingPadFraction) * 100}%`, height: 1, verticalAlign: 'top' }} aria-hidden />
        {overlay && (
          <div style={{ position: 'absolute', top: 0, left: 0, height, pointerEvents: 'none', zIndex: 3 }}>
            {overlay}
          </div>
        )}
        {status !== 'ready' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888',
              background: 'rgba(255,255,255,0.7)',
            }}
          >
            {status === 'error' ? `Error: ${error}` : `${status}…`}
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.72em', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
        single-line OSMD · {status}
        {renderMs ? ` · render ${renderMs.toFixed(0)}ms` : ''}
        {scoreWidth ? ` · ${scoreWidth.toFixed(0)}px wide` : ''}
        {equalBeatWidth ? ' · equal-beat-width' : ' · natural layout'}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Timeline construction
// --------------------------------------------------------------------------

/**
 * Walk the OSMD cursor through every step and record measure/beat/x positions.
 * Each entry corresponds to a single onset (note/chord/rest start).
 *
 * `scrollHost` is optional; when passed, xPx values are in scroll-host
 * content coordinates via getBoundingClientRect — robust against OSMD setting
 * the cursor's offsetParent to its own container (which would otherwise
 * report offsets that ignore sibling spacers / padding).
 */
export function buildBeatTimeline(
  osmd: any,
  scrollHost?: HTMLElement | null,
): InfiniteBeatStamp[] {
  const out: InfiniteBeatStamp[] = [];
  osmd.cursor.reset();
  osmd.cursor.show();
  let i = 0;
  let safety = 20000;
  let prevX: number | null = null;
  const hostRect = scrollHost?.getBoundingClientRect();
  const hostScrollLeft = scrollHost?.scrollLeft ?? 0;
  while (!osmd.cursor.iterator.EndReached && safety-- > 0) {
    const it = osmd.cursor.iterator;
    const ts = it.currentTimeStamp || it.CurrentTimeStamp;
    const absWhole = ts ? (ts.RealValue ?? ts.realValue ?? 0) : 0;
    const absoluteBeat = absWhole * 4;
    const measureIndex = it.CurrentMeasureIndex ?? it.currentMeasureIndex ?? 0;
    const measureStart = out.find((b) => b.measureIndex === measureIndex);
    const beatInMeasure = measureStart ? absoluteBeat - measureStart.absoluteBeat : 0;
    const cursorEl = osmd.cursor.cursorElement as HTMLElement | undefined;
    let xPx = cursorEl ? cursorEl.offsetLeft : 0;
    if (cursorEl && hostRect) {
      const r = cursorEl.getBoundingClientRect();
      xPx = r.left - hostRect.left + hostScrollLeft;
    }
    if (prevX != null && out.length > 0) {
      out[out.length - 1].widthPx = Math.max(2, xPx - prevX);
    }
    out.push({ index: i++, measureIndex, beatInMeasure, absoluteBeat, xPx, widthPx: 24 });
    prevX = xPx;
    osmd.cursor.next();
  }
  // Last entry inherits a default width
  osmd.cursor.reset();
  osmd.cursor.show();
  return out;
}

/**
 * For each measure, return its *left barline* x in scroll-host content
 * coordinates.
 *
 * Strategy: derive from the cursor timeline, not the rendered SVG. The
 * cursor gives us the x of the first note-onset in every measure; the
 * barline sits just to the left of that onset. We infer "just to the
 * left" by taking the midpoint between the previous measure's last onset
 * and the current measure's first onset, weighted toward the first onset
 * (~70 / 30) because OSMD/VexFlow leaves more padding to the right of a
 * notehead than to its left.
 *
 * Attempted but rejected: SVG DOM scanning. OSMD/VexFlow renders staff
 * lines + barlines + ledger lines as composite `<path>` elements, so
 * individual barlines aren't addressable as their own DOM nodes.
 */
export function buildMeasureStartXs(
  _osmd: any,
  _scrollHost?: HTMLElement | null,
  timeline?: InfiniteBeatStamp[],
): number[] {
  if (!timeline || timeline.length === 0) return [];

  const firstByMeasure = new Map<number, number>();
  const lastByMeasure = new Map<number, number>();
  for (const stamp of timeline) {
    if (!firstByMeasure.has(stamp.measureIndex)) {
      firstByMeasure.set(stamp.measureIndex, stamp.xPx);
    }
    lastByMeasure.set(stamp.measureIndex, stamp.xPx);
  }

  const maxMeasure = Math.max(...firstByMeasure.keys());
  const out: number[] = [];
  const LEAD_GAP_PX = 10; // fallback offset before the very first note

  // Measure 0: no prior measure to bracket against. Use the first onset
  // minus a small fixed gap to approximate the barline.
  out.push((firstByMeasure.get(0) ?? 0) - LEAD_GAP_PX);

  // Measures 1..N: weighted midpoint between prev-last-onset and this-first-onset.
  for (let m = 1; m <= maxMeasure; m++) {
    const prevLast = lastByMeasure.get(m - 1);
    const curFirst = firstByMeasure.get(m);
    if (prevLast == null || curFirst == null) {
      out.push(curFirst ?? prevLast ?? 0);
      continue;
    }
    out.push(0.3 * prevLast + 0.7 * curFirst);
  }

  // Trailing sentinel at the score's right edge.
  const last = timeline[timeline.length - 1];
  out.push(last.xPx + Math.max(last.widthPx, 20));
  return out;
}

/**
 * Compute the variance of (px-per-beat) across all measures in a timeline.
 * Used to characterize how uneven the natural OSMD layout is — useful for
 * the blog narrative ("at 132 BPM, scroll speed jitters between X and Y px/sec").
 */
export function beatWidthStats(
  timeline: InfiniteBeatStamp[],
): { minPxPerBeat: number; maxPxPerBeat: number; meanPxPerBeat: number; stddev: number } {
  if (timeline.length < 2) return { minPxPerBeat: 0, maxPxPerBeat: 0, meanPxPerBeat: 0, stddev: 0 };
  const ratios: number[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const dBeat = timeline[i].absoluteBeat - timeline[i - 1].absoluteBeat;
    const dx = timeline[i].xPx - timeline[i - 1].xPx;
    if (dBeat > 0 && dx > 0) ratios.push(dx / dBeat);
  }
  if (ratios.length === 0) return { minPxPerBeat: 0, maxPxPerBeat: 0, meanPxPerBeat: 0, stddev: 0 };
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length;
  return {
    minPxPerBeat: Math.min(...ratios),
    maxPxPerBeat: Math.max(...ratios),
    meanPxPerBeat: mean,
    stddev: Math.sqrt(variance),
  };
}
