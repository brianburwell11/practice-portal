import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useSheetMusicStore } from '../../store/sheetMusicStore';
import { measureStartTimes, currentMeasureIndex } from '../../audio/tempoUtils';
import { r2Url } from '../../utils/url';
import { InfiniteScoreRenderer, type InfiniteBeatStamp } from './InfiniteScoreRenderer';

/** Pixels to nudge the left focus point right of the waveform's left edge.
 *  Keep in sync with the same constant in `LyricsDisplay.tsx` so the
 *  lyric reading point, karaoke playhead, and window-mode first bar all
 *  line up vertically. */
const FOCUS_LEFT_NUDGE_PX = 24;

/** Pixels to extend the window-mode right boundary beyond the waveform's
 *  right edge. Only affects window mode; karaoke doesn't use the right
 *  boundary. Clamped to the scroll-host viewport. */
const FOCUS_RIGHT_NUDGE_PX = 32;

/**
 * Scrolling-sheet-music panel. Renders the current song's MusicXML if the
 * song config carries a `sheetMusicUrl`; otherwise renders nothing.
 *
 * Sync model (decided in the docs-site UX post):
 *   - Cursor granularity is **always measure**: we lerp linearly between
 *     consecutive measure taps, ignoring beat-level tap jitter.
 *   - Two user-facing tracking modes: karaoke (fixed playhead, scrolling
 *     score, no bbox) and window (static N-bar page with grayed prev/next
 *     margins, bbox spans the current measure).
 *   - Playhead line is always rendered full-system height, 2 px wide,
 *     colored with a soft glow so it's visible with or without the bbox.
 *
 * Sync plumbing mirrors `LyricsDisplay`: we read `useTransportStore.position`
 * via a Zustand selector (no RAF loop) and update scroll / bbox state in a
 * useEffect on position change.
 */
export function ScrollingScore() {
  const song = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const position = useTransportStore((s) => s.position);
  const trackingMode = useSheetMusicStore((s) => s.trackingMode);
  const scoreZoom = useSheetMusicStore((s) => s.scoreZoom);
  const equalBeatWidthOverride = useSheetMusicStore((s) => s.equalBeatWidthOverride);
  const setTrackingMode = useSheetMusicStore((s) => s.setTrackingMode);
  const setScoreZoom = useSheetMusicStore((s) => s.setScoreZoom);
  const setEqualBeatWidthOverride = useSheetMusicStore((s) => s.setEqualBeatWidthOverride);

  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null);
  const [cursorPx, setCursorPx] = useState(0);
  const [bbox, setBbox] = useState<{ leftPx: number; widthPx: number } | null>(null);
  const [trainGrayLeftPx, setTrainGrayLeftPx] = useState(0);
  const [trainGrayRightStartPx, setTrainGrayRightStartPx] = useState<number | null>(null);
  const [windowAnchor, setWindowAnchor] = useState(0);
  /** Viewport-x where the sticky preamble (clef/key/time) sits. Slides
   *  left with the scroll in karaoke mode until it hits 0, then pins. */
  const [stickyPreambleLeftPx, setStickyPreambleLeftPx] = useState(0);
  /** Width of the preamble (clef+key sig), in SVG-local px. Derived from
   *  the first measure's barline position minus the leading-pad spacer,
   *  minus an estimate of the time signature width (which lives after the
   *  key signature but is excluded from the sticky region). */
  const [preambleWidth, setPreambleWidth] = useState(0);
  /** Live SVG ref — stored in state so a useEffect can re-mount the clone
   *  whenever either the SVG OR the host div changes. */
  const [liveSvg, setLiveSvg] = useState<SVGSVGElement | null>(null);
  /** Host div for the cloned preamble SVG. Stored via a ref callback so
   *  we get a re-render when it mounts/unmounts (the overlay is
   *  conditionally rendered, so this can appear after the SVG-ready
   *  callback already fired). */
  const [preambleHost, setPreambleHost] = useState<HTMLDivElement | null>(null);
  /** Incremented on window resize / scroll-host resize. Used as a sync-effect
   *  dependency so window-mode re-derives how many bars fit when the
   *  viewport changes (browser resize, mobile rotate, etc.). */
  const [resizeTick, setResizeTick] = useState(0);

  // Resolve the score URL. Following the rest of the codebase's R2 convention:
  // the field in the song config is a *filename* (e.g. "score.musicxml") that
  // lives alongside the song's other files at `{bandId}/songs/{songId}/`. If
  // the caller already supplied an absolute URL (starts with "http" or "/"),
  // we pass it through unchanged — useful for external hosting.
  const sheetMusicUrl = useMemo(() => {
    const raw = song?.sheetMusicUrl;
    if (!raw) return undefined;
    if (/^https?:\/\//.test(raw) || raw.startsWith('/')) return raw;
    if (!currentBand || !song) return undefined;
    return r2Url(`${currentBand.id}/songs/${song.id}/${raw}`);
  }, [song, currentBand]);
  const effectiveEqualBeatWidth = equalBeatWidthOverride ?? song?.equalBeatWidth ?? false;

  // tapMap-based measure-start timeline
  const measureTimes = useMemo(() => measureStartTimes(song?.tapMap), [song?.tapMap]);

  // Audio offset: explicit field in song config, else the first measure-tap time
  const audioOffset = useMemo(() => {
    if (!song) return 0;
    if (typeof song.audioOffsetSeconds === 'number') return song.audioOffsetSeconds;
    return measureTimes[0] ?? 0;
  }, [song, measureTimes]);

  const handleReady = useCallback((_osmd: any) => { /* reserved for future hook-ins */ }, []);
  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);
  const handleMeasureXs = useCallback((xs: number[]) => setMeasureXs(xs), []);

  const handleSvgReady = useCallback((svg: SVGSVGElement | null) => {
    setLiveSvg(svg);
  }, []);

  // Bootstrap + refine the sticky preamble.
  //
  // This has to handle a chicken-and-egg: the sticky-preamble wrapper
  // only renders when `preambleWidth > 0`, and `preambleHost` only
  // populates once the wrapper is in the DOM. So we first compute a
  // `fallback` width (first-note-x minus a small gap) and set that,
  // which lets the wrapper render. On the next effect run, both
  // `liveSvg` and `preambleHost` are available and we refine the width
  // via DOM measurement — walk every <text>/<path> in the clone and
  // find the rightmost glyph whose right edge lies in the preamble
  // region (before the first note). That gives a pixel-accurate cutoff
  // at any zoom or time-signature width.
  useEffect(() => {
    if (!scrollHost || timeline.length === 0) {
      preambleHost?.replaceChildren();
      setPreambleWidth(0);
      return;
    }
    const spacerPx = scrollHost.clientWidth * 0.22;
    const firstNoteLocalX = timeline[0].xPx - spacerPx;
    const PADDING_PX = 6;
    const fallback = Math.max(40, firstNoteLocalX - PADDING_PX);

    // Step 1: bootstrap. If the host or SVG isn't ready, set the
    // fallback width so the wrapper renders and the host ref populates.
    if (!preambleHost || !liveSvg) {
      preambleHost?.replaceChildren();
      setPreambleWidth(fallback);
      return;
    }

    // Step 2: mount the clone and refine via DOM measurement.
    const clone = liveSvg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[id*="cursor"], [id*="Cursor"]').forEach((el) => el.remove());
    clone.style.display = 'block';
    preambleHost.replaceChildren(clone);

    let rightmostEdge = 0;
    const glyphs = clone.querySelectorAll('text, path');
    for (const el of Array.from(glyphs)) {
      let bbox: DOMRect | null = null;
      try { bbox = (el as SVGGraphicsElement).getBBox(); } catch { /* detached */ }
      if (!bbox) continue;
      const right = bbox.x + bbox.width;
      // Exclude staff-line paths and anything past the first note. Staff
      // lines span the full score width so the `right < firstNoteLocalX`
      // filter keeps them out automatically.
      if (right > rightmostEdge && right < firstNoteLocalX - 3) {
        rightmostEdge = right;
      }
    }

    const measured = rightmostEdge > 0 ? rightmostEdge + PADDING_PX : fallback;
    setPreambleWidth(Math.max(40, Math.min(measured, firstNoteLocalX - 2)));
  }, [liveSvg, preambleHost, scrollHost, timeline, resizeTick]);

  // Grab a handle to the renderer's scroll host the first time we render.
  // InfiniteScoreRenderer's root element *is* the scroll host, so we just
  // capture it via a ref callback on the wrapper.
  const rendererWrapperRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) { setScrollHost(null); return; }
    const host = el.querySelector('div[style*="overflow-x: auto"]') as HTMLDivElement | null
      ?? el.firstElementChild as HTMLDivElement | null;
    setScrollHost(host);
  }, [sheetMusicUrl, scoreZoom, effectiveEqualBeatWidth]);

  // Reset the window anchor whenever the song changes
  useEffect(() => { setWindowAnchor(0); }, [sheetMusicUrl]);

  // Track scroll-host + waveform sizes so the window-bars-per-page
  // calculation updates on browser resize / device rotation / layout shift.
  // The waveform is the source of truth for the window's left/right edges —
  // we align the sheet-music window to it so bars sit directly above their
  // corresponding region in the waveform.
  useEffect(() => {
    if (!scrollHost) return;
    const bump = () => setResizeTick((n) => n + 1);
    bump();
    const ro = new ResizeObserver(bump);
    ro.observe(scrollHost);
    const waveformEl = document.querySelector('[data-waveform-timeline]');
    if (waveformEl) ro.observe(waveformEl);
    return () => ro.disconnect();
  }, [scrollHost]);

  // Sync effect — runs on every transport position update via the Zustand
  // subscription. This is the same pattern LyricsDisplay uses: no RAF loop,
  // just re-derive state when `position` changes.
  useEffect(() => {
    if (!scrollHost || timeline.length === 0 || measureXs.length < 2) return;

    const t = position - audioOffset;

    // Cursor x: measure-granularity lerp between consecutive barlines
    let mIdx = 0;
    let cursorContentX: number;
    if (measureTimes.length >= 2) {
      mIdx = currentMeasureIndex(t + audioOffset, measureTimes);
      const t0 = measureTimes[mIdx];
      const t1 = measureTimes[mIdx + 1] ?? t0 + 1;
      const frac = Math.max(0, Math.min(1, (t + audioOffset - t0) / Math.max(0.001, t1 - t0)));
      const x0 = measureXs[mIdx] ?? 0;
      const x1 = measureXs[mIdx + 1] ?? x0;
      cursorContentX = x0 + frac * (x1 - x0);
    } else {
      // No tapMap measures: fall back to the first measure's x and freeze
      cursorContentX = measureXs[0] ?? 0;
    }

    const viewport = scrollHost.clientWidth;

    // The waveform's bounding rect is the source of truth for the focus
    // point in *both* modes: karaoke uses its left edge as the playhead
    // position; window mode uses its left and right edges as the bar
    // window's boundaries. Falls back to sensible defaults if the
    // waveform isn't in the DOM yet (initial render / no song selected).
    //
    // A small rightward offset (FOCUS_LEFT_NUDGE_PX) is applied to the
    // LEFT edge only — the karaoke playhead / first bar sits just right
    // of the waveform's left edge, giving some breathing room before the
    // first measure. Must stay in sync with LyricsDisplay's identical
    // nudge so the two focus points still line up vertically.
    const waveformEl = document.querySelector('[data-waveform-timeline]') as HTMLElement | null;
    const hostRect = scrollHost.getBoundingClientRect();
    let focusLeftPx = viewport * 0.22;
    let focusRightPx = viewport;
    if (waveformEl) {
      const wfRect = waveformEl.getBoundingClientRect();
      focusLeftPx = Math.max(0, wfRect.left - hostRect.left);
      focusRightPx = Math.min(viewport, wfRect.right - hostRect.left + FOCUS_RIGHT_NUDGE_PX);
    }
    focusLeftPx = Math.min(focusLeftPx + FOCUS_LEFT_NUDGE_PX, focusRightPx - 40);

    if (trackingMode === 'karaoke') {
      // Fixed playhead at the waveform's left edge; score scrolls under it.
      scrollHost.scrollLeft = Math.max(0, cursorContentX - focusLeftPx);
      setCursorPx(focusLeftPx);
      setBbox(null); // karaoke: no bbox, just the playhead line
      setTrainGrayLeftPx(0);
      setTrainGrayRightStartPx(null);
      // Sticky preamble: slides left with the scroll until it hits 0,
      // then pins. `spacerPx` is the leading blank region before the SVG
      // starts (matches InfiniteScoreRenderer's leadingPadFraction).
      // `preambleWidth` itself is computed by the clone-mount effect via
      // DOM measurement of the actual glyph positions — no heuristic here.
      const spacerPx = viewport * 0.22;
      const scrolled = scrollHost.scrollLeft;
      setStickyPreambleLeftPx(Math.max(0, spacerPx - scrolled));
    } else {
      // Window mode:
      // - The first bar's left barline is anchored at the waveform's left
      //   edge (converted into scroll-host-local viewport coords). The
      //   last fully-fit measure ends at or before the waveform's right
      //   edge. Everything outside that window is grayed.
      const usableWidth = Math.max(1, focusRightPx - focusLeftPx);

      let anchor = windowAnchor;
      let bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);

      if (mIdx < anchor) {
        // Seek backward — jump to a page that starts at mIdx
        anchor = mIdx;
        bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);
        setWindowAnchor(anchor);
      } else if (mIdx >= anchor + bars) {
        // Forward progress — walk page-by-page because each page has its
        // own bars-count (real measures vary in rendered width)
        let safety = 200;
        while (mIdx >= anchor + bars && safety-- > 0 && anchor + bars < measureXs.length - 1) {
          anchor = anchor + bars;
          bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);
        }
        setWindowAnchor(anchor);
      }

      const anchorX = measureXs[anchor] ?? 0;
      // Scroll so the first bar's barline sits at the waveform's left edge
      scrollHost.scrollLeft = Math.max(0, anchorX - focusLeftPx);
      setCursorPx(cursorContentX - scrollHost.scrollLeft);
      // Bbox spans the current measure (snappiness: measure, anchor: start)
      const measureLeft = measureXs[mIdx] ?? cursorContentX;
      const measureRight = measureXs[mIdx + 1] ?? (measureLeft + 120);
      setBbox({
        leftPx: measureLeft - scrollHost.scrollLeft,
        widthPx: Math.max(20, measureRight - measureLeft),
      });
      // Grayed left: 0 → waveform's left edge
      setTrainGrayLeftPx(focusLeftPx);
      // Grayed right: from the right edge of the last full-fit bar to the
      // viewport's right edge — also clamped to start no earlier than the
      // waveform's right edge so it shows any content that bleeds past.
      const rightEndX = measureXs[anchor + bars];
      const rightEndInViewport = rightEndX != null ? rightEndX - scrollHost.scrollLeft : focusRightPx;
      setTrainGrayRightStartPx(Math.min(rightEndInViewport, focusRightPx));
      // preambleWidth is left at its measured value — the sticky preamble
      // overlay is gated on `trackingMode === 'karaoke'` at render time,
      // so it stays hidden in window mode without us touching state here.
    }
  }, [
    position, audioOffset, scrollHost, timeline, measureXs, measureTimes,
    trackingMode, windowAnchor, resizeTick,
  ]);

  if (!sheetMusicUrl) return null;

  // Minimum height for the renderer — the actual height auto-fits the
  // rendered score so all instruments/staves are visible.
  const minRenderHeight = Math.max(180, 220 * scoreZoom);
  const PLAYHEAD_COLOR = '#22D3EE';

  // All overlay children use `top: 0; bottom: 0` so they stretch to the
  // wrapper's auto-sized height — the playhead line and bbox span the
  // full rendered score, however tall it ends up.
  const overlay = (
    <>
      {/* Playhead line — full-system height, always visible */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0,
        left: cursorPx - 1, width: 2,
        background: PLAYHEAD_COLOR, opacity: 0.9,
        boxShadow: `0 0 6px rgba(34,211,238,0.6)`,
        pointerEvents: 'none', zIndex: 5,
      }} />
      {/* Window-mode bbox — spans the current measure */}
      {bbox && (
        <div style={{
          position: 'absolute', top: 4, bottom: 4,
          left: bbox.leftPx, width: bbox.widthPx,
          background: 'rgba(34,211,238,0.15)',
          borderRadius: 2, pointerEvents: 'none', zIndex: 4,
        }} />
      )}
      {/* Window-mode grayed prev-bar tail on the left */}
      {trainGrayLeftPx > 0 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 0, width: trainGrayLeftPx,
          background: 'rgba(255,255,255,0.5)',
          borderRight: '1px dashed rgba(107,159,214,0.5)',
          pointerEvents: 'none', zIndex: 3,
        }} />
      )}
      {/* Window-mode grayed next-page region on the right */}
      {trainGrayRightStartPx != null && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: Math.max(0, trainGrayRightStartPx), right: 0,
          background: 'rgba(255,255,255,0.5)',
          borderLeft: '1px dashed rgba(107,159,214,0.5)',
          pointerEvents: 'none', zIndex: 3,
        }} />
      )}
      {/* Karaoke-mode sticky preamble — a clipped clone of the rendered
          SVG's first `preambleWidth` pixels (clef + key signature; the
          time signature is excluded). Slides left with the scroll until
          it pins at left=0. Opaque so it covers the original score when
          the two overlap. */}
      {trackingMode === 'karaoke' && preambleWidth > 0 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: stickyPreambleLeftPx, width: preambleWidth,
          overflow: 'hidden', pointerEvents: 'none', zIndex: 6,
          background: '#fff',
        }}>
          <div ref={setPreambleHost} style={{ position: 'absolute', top: 0, left: 0 }} />
        </div>
      )}
    </>
  );

  return (
    <div className="px-2 py-1 border-b border-gray-800">
      <div className="flex items-center gap-2 mb-1 text-xs">
        <div className="flex gap-1">
          <button
            onClick={() => setTrackingMode('karaoke')}
            className={`px-2 py-0.5 rounded ${trackingMode === 'karaoke' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          >karaoke</button>
          <button
            onClick={() => setTrackingMode('window')}
            className={`px-2 py-0.5 rounded ${trackingMode === 'window' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          >window</button>
        </div>
        <label className="flex items-center gap-1 text-gray-400">
          zoom
          <input
            type="range"
            min={0.6} max={1.5} step={0.05}
            value={scoreZoom}
            onChange={(e) => setScoreZoom(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="tabular-nums w-10 text-right">{(scoreZoom * 100).toFixed(0)}%</span>
        </label>
        <button
          onClick={() => setEqualBeatWidthOverride(effectiveEqualBeatWidth ? false : true)}
          className={`px-2 py-0.5 rounded ${effectiveEqualBeatWidth ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          title="Toggle between OSMD's natural beat-width layout and equal-beat-width"
        >{effectiveEqualBeatWidth ? 'equal-beat' : 'natural'}</button>
      </div>
      <div ref={rendererWrapperRef} style={{ position: 'relative' }}>
        <InfiniteScoreRenderer
          url={sheetMusicUrl}
          height={minRenderHeight}
          zoom={scoreZoom}
          equalBeatWidth={effectiveEqualBeatWidth}
          leadingPadFraction={0.22}
          onReady={handleReady}
          onTimeline={handleTimeline}
          onMeasureXs={handleMeasureXs}
          onSvgReady={handleSvgReady}
        />
        {/* Overlay — sibling of the scroll host (NOT inside it) so the
            playhead stays fixed to the viewport instead of scrolling with
            the score content. `inset: 0` stretches it to the wrapper's
            auto-sized height so the playhead line + bbox span the full
            rendered score, no matter how many staves it has. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}>
          {overlay}
        </div>
      </div>
    </div>
  );
}

/**
 * How many measures starting at `anchor` fully fit inside `usablePx`?
 * A measure fits if its right barline is within `usablePx` of its left.
 * The first measure that doesn't fully fit becomes the anchor of the next
 * page — it is **not** included in this page. Always returns at least 1
 * so pathologically narrow viewports still render something.
 */
function barsFittingFromAnchor(
  anchor: number,
  usablePx: number,
  measureXs: number[],
): number {
  if (measureXs.length < 2 || anchor >= measureXs.length - 1) return 1;
  const anchorX = measureXs[anchor];
  const available = Math.max(1, usablePx);
  let fits = 0;
  for (let n = 1; anchor + n < measureXs.length; n++) {
    const rightX = measureXs[anchor + n];
    if (rightX - anchorX > available) break;
    fits = n;
  }
  const remaining = measureXs.length - 1 - anchor;
  return Math.max(1, Math.min(fits, remaining));
}
