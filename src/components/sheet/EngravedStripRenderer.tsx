import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseMusicXML, unfold, type MusicXMLStructure, type UnfoldedStep } from '../../audio/unfoldRepeats';
import { fetchSongScore, preloadScoreEngine, ScoreEngine, scorePartIds, type SongScoreFiles } from './page/museEncoreEngine';

/** Canvas tiles: the continuous line is far wider than one canvas may be. */
const TILE_CSS_PX = 1024;
const CSS_DPI = 96;
/** The playhead sits this far before the first note at the downbeat. */
const FIRST_BEAT_LEAD_IN = 0.08;

export interface PartInfo {
  /** MusicXML part id (e.g. "P1"); saved hidden parts use it. */
  id: string;
  /** Instrument name. */
  name: string;
  /** 0-based index in the score's instrument list. */
  index: number;
}

/**
 * MuseScore's continuous panel for the strip: the staff names and brackets,
 * then the clef, key and time signature in force, as at the left edge of a
 * view. It changes as the music does (a new key, a clef change, 3/4 to 4/4).
 */
export interface ContinuousPanel {
  /** Where it is drawn (CSS width `PANEL_MAX_PX`; only `update`'s width of it is the panel). */
  canvas: HTMLCanvasElement;
  /** Scroll-host content x where the score's own header begins: a panel
   *  placed here matches it exactly, so it can ride along with it. */
  headerContentX: number;
  /**
   * Draws the panel for a view whose left edge is at scroll-host content x
   * `contentX` (at the start of the score, as if measure 1 were just past
   * it, so there is always something to show). Returns the panel's width in
   * px, or null if there's nothing to draw. Repaints only when what it shows
   * changes.
   */
  update(contentX: number): number | null;
}

/** The widest the panel can be (CSS px): its canvas is this wide. */
const PANEL_MAX_PX = 480;

interface Props {
  files: SongScoreFiles;
  /** Minimum height while loading. */
  height?: number;
  /** 1 = MuseScore's 100% on a 96 dpi screen. */
  zoom?: number;
  /** Blank space before the score, so beat 0 can sit under the playhead. */
  leadingPadPx?: number;
  /** The scrolling element (this component's root). */
  onScrollHost?: (host: HTMLDivElement | null) => void;
  /** Measure start positions in scroll-host content px, plus the end of the last one. */
  onMeasureXs?: (xs: number[]) => void;
  onPanel?: (panel: ContinuousPanel | null) => void;
  onParts?: (parts: PartInfo[]) => void;
  onUnfoldedOrder?: (steps: UnfoldedStep[]) => void;
  visiblePartIds?: Set<string>;
  repeatAfterDcDs?: boolean;
}

interface Layout {
  scale: number;
  dpr: number;
  /** Cropped top of the line, inches. */
  top: number;
  widthPx: number;
  heightPx: number;
}

/**
 * The scrolling strip, drawn by MuseScore's own engraving engine (muse-encore,
 * via `ScoreEngine`) in MuseScore's continuous view: the whole score on one
 * line, exactly as MuseScore draws it, from the song's .mscz when it has one.
 *
 * The root element is the scroll host, with a fixed leading pad (so beat 0
 * can sit under the playhead) and a trailing pad (so the last measure can
 * reach it). The repeat order comes from the MusicXML (`unfold`), which
 * honors `repeatAfterDcDs`.
 *
 * The line is drawn into canvas tiles as they scroll into view, and tiles far
 * from the view are dropped, so a long score never holds a huge bitmap.
 */
export function EngravedStripRenderer({
  files,
  height = 220,
  zoom = 1,
  leadingPadPx = 180,
  onScrollHost,
  onMeasureXs,
  onPanel,
  onParts,
  onUnfoldedOrder,
  visiblePartIds,
  repeatAfterDcDs = false,
}: Props) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const tilesHostRef = useRef<HTMLDivElement | null>(null);
  const tilesRef = useRef(new Map<number, HTMLCanvasElement>());
  const structureRef = useRef<MusicXMLStructure | null>(null);
  const partsRef = useRef<PartInfo[]>([]);
  const [engine, setEngine] = useState<ScoreEngine | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hostWidth, setHostWidth] = useState(0);

  // Keep the latest callbacks without re-running effects when they change.
  const cb = useRef({ onScrollHost, onMeasureXs, onPanel, onParts, onUnfoldedOrder });
  useLayoutEffect(() => {
    cb.current = { onScrollHost, onMeasureXs, onPanel, onParts, onUnfoldedOrder };
  });

  useLayoutEffect(() => {
    const callbacks = cb.current;
    callbacks.onScrollHost?.(scrollHostRef.current);
    return () => callbacks.onScrollHost?.(null);
  }, []);

  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host) return;
    setHostWidth(host.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setHostWidth(e.contentRect.width);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Load the score.
  const filesKey = `${files.mxlUrl}|${files.msczUrl ?? ''}|${files.modified ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setEngine(null);
    setLayout(null);
    (async () => {
      try {
        // The score and the engine (code and fonts) download together.
        const [{ xml, source }] = await Promise.all([fetchSongScore(files), preloadScoreEngine()]);
        if (cancelled) return;
        try {
          structureRef.current = parseMusicXML(xml);
          cb.current.onUnfoldedOrder?.(unfold(structureRef.current, { repeatAfterDcDs }));
        } catch (e) {
          console.warn('Repeat unfold failed; falling back to written order', e);
          structureRef.current = null;
          cb.current.onUnfoldedOrder?.([]);
        }
        const e = await ScoreEngine.open(source, { mode: 'line' });
        if (cancelled) return;
        const ids = scorePartIds(xml);
        const parts = e.parts().map((p, i) => ({
          id: ids.length === e.parts().length && ids[i] ? ids[i] : `P${i + 1}`,
          name: p.name,
          index: i,
        }));
        partsRef.current = parts;
        cb.current.onParts?.(parts);
        setEngine(e);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('Engraved score failed to load', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  // Re-run the unfold when the per-song repeat setting flips.
  useEffect(() => {
    if (!structureRef.current || status !== 'ready') return;
    try {
      cb.current.onUnfoldedOrder?.(unfold(structureRef.current, { repeatAfterDcDs }));
    } catch (e) {
      console.warn('Repeat unfold re-run failed', e);
    }
  }, [repeatAfterDcDs, status]);

  // Lay out (zoom, hidden parts) and publish the geometry.
  const visibleKey = visiblePartIds ? Array.from(visiblePartIds).sort().join('|') : '';
  useEffect(() => {
    if (!engine) return;
    const parts = partsRef.current;
    const hidden = new Set<number>();
    if (visiblePartIds && visiblePartIds.size > 0) {
      for (const p of parts) if (!visiblePartIds.has(p.id)) hidden.add(p.index);
    }
    // At least one part stays visible.
    if (hidden.size >= parts.length) hidden.clear();
    engine.setHiddenParts(hidden);

    const scale = CSS_DPI * zoom;
    const dpr = window.devicePixelRatio || 1;
    const page = engine.pageSize(0);
    const bounds = engine.contentBounds();
    const rects = engine.measureRects();

    // Barlines in scroll-host content px. Measure 1 starts at its first beat,
    // not at the clef its rectangle begins with.
    const xs: number[] = [];
    let prev = 0;
    rects.forEach((r, i) => {
      let x = r ? r.x : prev;
      if (i === 0) {
        const beat = engine.firstBeatX();
        if (beat !== null) x = Math.max(x, beat - FIRST_BEAT_LEAD_IN);
      }
      xs.push(leadingPadPx + x * scale);
      prev = r ? r.x + r.width : prev;
    });
    xs.push(leadingPadPx + prev * scale);

    cb.current.onMeasureXs?.(xs);

    const heightPx = Math.ceil((bounds.bottom - bounds.top) * scale);
    cb.current.onPanel?.(heightPx > 0 ? makePanel(engine, scale, dpr, bounds.top, page.height, heightPx, leadingPadPx, rects[0]?.x ?? 0) : null);

    setLayout({ scale, dpr, top: bounds.top, widthPx: Math.ceil(page.width * scale), heightPx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, zoom, visibleKey, leadingPadPx]);

  useEffect(() => {
    const callbacks = cb.current;
    return () => callbacks.onPanel?.(null);
  }, []);

  // Draw the tiles in and near the view; drop far ones.
  useEffect(() => {
    const host = scrollHostRef.current;
    const tilesHost = tilesHostRef.current;
    const tiles = tilesRef.current;
    for (const c of tiles.values()) c.remove();
    tiles.clear();
    if (!engine || !layout || !host || !tilesHost) return;

    const tileCount = Math.ceil(layout.widthPx / TILE_CSS_PX);
    const dpi = layout.scale * layout.dpr;
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewLeft = host.scrollLeft - leadingPadPx;
      const view = host.clientWidth;
      const first = Math.max(0, Math.floor((viewLeft - view) / TILE_CSS_PX));
      const last = Math.min(tileCount - 1, Math.floor((viewLeft + 2 * view) / TILE_CSS_PX));
      for (const [i, c] of tiles) {
        if (i < first - 2 || i > last + 2) { c.remove(); tiles.delete(i); }
      }
      for (let i = first; i <= last; i++) {
        if (tiles.has(i)) continue;
        const left = i * TILE_CSS_PX;
        const w = Math.min(TILE_CSS_PX, layout.widthPx - left);
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(w * layout.dpr);
        canvas.height = Math.ceil(layout.heightPx * layout.dpr);
        canvas.style.cssText = `position:absolute;top:0;left:${left}px;width:${w}px;height:${layout.heightPx}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          engine.draw(ctx, 0, dpi, {
            x: Math.round(left * layout.dpr),
            y: layout.top * dpi,
            width: canvas.width,
            height: canvas.height,
          });
        }
        tilesHost.appendChild(canvas);
        tiles.set(i, canvas);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    host.addEventListener('scroll', schedule, { passive: true });
    return () => {
      host.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [engine, layout, leadingPadPx, hostWidth]);

  return (
    <div
      ref={scrollHostRef}
      style={{
        position: 'relative',
        minHeight: status === 'ready' ? undefined : height,
        overflowX: 'auto',
        overflowY: 'hidden',
        background: '#fff',
        borderRadius: 6,
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{ display: 'inline-block', width: leadingPadPx, height: 1, verticalAlign: 'top' }} aria-hidden />
      <div
        ref={tilesHostRef}
        style={{
          display: 'inline-block',
          position: 'relative',
          verticalAlign: 'top',
          width: layout?.widthPx ?? 0,
          height: layout?.heightPx ?? 0,
        }}
      />
      {/* Trailing pad: at least the view's width, so the last measure can
          still scroll to a near-left focus point. */}
      <div style={{ display: 'inline-block', width: Math.max(800, hostWidth), height: 1, verticalAlign: 'top' }} aria-hidden />
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
          {status === 'error' ? `Couldn't show this score: ${error}` : 'Loading score…'}
        </div>
      )}
    </div>
  );
}

/**
 * The continuous panel at this layout. muse-encore paints it over the page's
 * full height (it sets the canvas transform itself), so it goes to a scratch
 * canvas first and only the strip's cropped band is copied to the one shown.
 */
function makePanel(
  engine: ScoreEngine,
  scale: number,
  dpr: number,
  topInches: number,
  pageHeightInches: number,
  heightPx: number,
  leadingPadPx: number,
  firstMeasureInches: number,
): ContinuousPanel {
  const dpi = scale * dpr;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(PANEL_MAX_PX * dpr);
  canvas.height = Math.ceil(heightPx * dpr);
  canvas.style.cssText = `display:block;width:${PANEL_MAX_PX}px;height:${heightPx}px`;
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = Math.ceil(pageHeightInches * dpi);
  const scratchCtx = scratch.getContext('2d');
  const ctx = canvas.getContext('2d');
  let shownKey: string | undefined;

  const headerLeft = engine.headerLeft() ?? 0;
  return {
    canvas,
    headerContentX: leadingPadPx + headerLeft * scale,
    update(contentX) {
      if (!ctx || !scratchCtx) return null;
      // MuseScore shows no panel while measure 1 starts inside it (the score's
      // own header is there); ask as if it were just past, for the same contents.
      const left = Math.max(firstMeasureInches, (contentX - leadingPadPx) / scale);
      const result = engine.drawContinuousPanel(scratchCtx, dpi, left, topInches, shownKey);
      if (!result) { shownKey = undefined; return null; }
      if (result.painted) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(scratch, 0, Math.round(topInches * dpi), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      }
      shownKey = result.key;
      return Math.min(PANEL_MAX_PX, result.width * scale);
    },
  };
}
