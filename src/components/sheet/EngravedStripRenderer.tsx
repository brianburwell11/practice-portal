import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseMusicXML, unfold, type MusicXMLStructure, type UnfoldedStep } from '../../audio/unfoldRepeats';
import { fetchSongScore, ScoreEngine, type SongScoreFiles } from './page/museEncoreEngine';

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

export interface PreambleImage {
  /** The clef, key and time signature at the start of the line. */
  canvas: HTMLCanvasElement;
  widthPx: number;
  /** Where it starts, in content px after the leading pad (past the page margin and staff names). */
  offsetPx: number;
}

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
  onPreamble?: (preamble: PreambleImage | null) => void;
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

/** MusicXML part ids in instrument order (the strip's saved hidden parts use them). */
function partIdsOf(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.querySelectorAll('score-part')).map((el) => el.getAttribute('id') ?? '');
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
  onPreamble,
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
  const cb = useRef({ onScrollHost, onMeasureXs, onPreamble, onParts, onUnfoldedOrder });
  useLayoutEffect(() => {
    cb.current = { onScrollHost, onMeasureXs, onPreamble, onParts, onUnfoldedOrder };
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
        const { xml, source } = await fetchSongScore(files);
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
        const ids = partIdsOf(xml);
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

    // The pinned preamble: the clef, key and time signature, from where
    // measure 1 starts (past the margin, staff names and brackets) to its
    // first beat. Kept narrow so it never covers the playhead.
    const preambleStart = Math.round((rects[0]?.x ?? 0) * scale);
    const preambleWidth = Math.max(0, Math.round(xs[0] - leadingPadPx) - preambleStart);
    const heightPx = Math.ceil((bounds.bottom - bounds.top) * scale);
    if (preambleWidth > 0 && heightPx > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(preambleWidth * dpr);
      canvas.height = Math.ceil(heightPx * dpr);
      canvas.style.cssText = `display:block;width:${preambleWidth}px;height:${heightPx}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        engine.draw(ctx, 0, scale * dpr, {
          x: Math.round(preambleStart * dpr),
          y: bounds.top * scale * dpr,
          width: canvas.width,
          height: canvas.height,
        });
      }
      cb.current.onPreamble?.({ canvas, widthPx: preambleWidth, offsetPx: preambleStart });
    } else {
      cb.current.onPreamble?.(null);
    }

    setLayout({ scale, dpr, top: bounds.top, widthPx: Math.ceil(page.width * scale), heightPx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, zoom, visibleKey, leadingPadPx]);

  useEffect(() => {
    const callbacks = cb.current;
    return () => callbacks.onPreamble?.(null);
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
