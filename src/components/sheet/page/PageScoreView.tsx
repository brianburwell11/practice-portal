import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseMusicXML, unfold, type MusicXMLStructure, type UnfoldedStep } from '../../../audio/unfoldRepeats';
import { useAudioEngine } from '../../../hooks/useAudioEngine';
import { useSheetMusicStore } from '../../../store/sheetMusicStore';
import { useTransportStore } from '../../../store/transportStore';
import { loadSheetMusicSongState } from '../../../utils/sheetMusicSongStorage';
import { firstPlayedIndex, PAST_END, writtenOf } from '../scorePosition';
import { useScorePosition } from '../useScorePosition';
import { fetchSongScore, ScoreEngine, scorePartIds, type MeasureRect, type SongScoreFiles } from './museEncoreEngine';

const CSS_DPI = 96;
/** Canvas tiles are at most this tall (CSS px), so a long page never needs one huge bitmap. */
const TILE_PX = 1024;
const PAGE_GAP_PX = 16;
const GUTTER_PX = 12;
/** Fitted pages never grow past this (px per inch), so a big screen doesn't show giant notes. */
const MAX_FIT_SCALE = 1.6 * CSS_DPI;
/** Below this width, 'auto' reflows the music to the screen instead of showing pages. */
const REFLOW_BELOW_PX = 700;
/** Follow resumes this long after the last scroll, swipe or wheel. */
const FOLLOW_RESUME_MS = 3000;
/** A press that moves less than this is a tap (seek), not a drag. */
const TAP_SLOP_PX = 6;
/** Past this far through a measure, follow makes sure the next measure played is in view too. */
const LOOKAHEAD_FRACTION = 0.6;

export type PageLayoutMode = 'auto' | 'page' | 'fit-width';

interface Props {
  files: SongScoreFiles;
  /** For the saved hidden parts. */
  songId: string;
  repeatAfterDcDs?: boolean;
  /** 'page': MuseScore's own pages. 'fit-width': re-wrapped to the screen. 'auto': pages unless narrow. */
  layoutMode?: PageLayoutMode;
}

interface PageBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** A measure's box in content px, plus where its first beat is. */
interface MeasureBox {
  left: number;
  top: number;
  width: number;
  height: number;
  beat: number;
}

interface Geometry {
  mode: 'page' | 'fit-width';
  /** CSS px per inch. */
  scale: number;
  pages: PageBox[];
  width: number;
  height: number;
  /** Written measures, in content px. */
  measures: (MeasureBox | null)[];
}

/** Where to put the reading position back after a re-layout. */
interface Anchor {
  written: number;
  /** The measure's top, in px from the top of the view. */
  viewY: number;
}

/**
 * The score as pages, drawn by MuseScore's own engine (muse-encore): exactly
 * MuseScore's pages, or re-wrapped to the screen width on narrow screens.
 * It follows playback with a measure highlight and a cursor, and lets you tap
 * a measure to jump there, scroll ahead (follow pauses, then resumes), and
 * pinch or ctrl/⌘+wheel to zoom.
 *
 * The cursor comes from the same `useScorePosition` as the scrolling strip,
 * so the two always agree.
 */
export function PageScoreView({ files, songId, repeatAfterDcDs = false, layoutMode = 'auto' }: Props) {
  const audio = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);
  const zoom = useSheetMusicStore((s) => s.pageZoom);
  const setZoom = useSheetMusicStore((s) => s.setPageZoom);
  const invert = useSheetMusicStore((s) => s.pageInvert);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pagesLayerRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);
  const structureRef = useRef<MusicXMLStructure | null>(null);

  const [engine, setEngine] = useState<ScoreEngine | null>(null);
  const [unfolded, setUnfolded] = useState<UnfoldedStep[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [followPaused, setFollowPaused] = useState(false);
  const lastUserScrollRef = useRef(0);
  const anchorRef = useRef<Anchor | null>(null);

  const writtenCount = geometry?.measures.length ?? 0;
  const { measureTimes, scorePosition } = useScorePosition(unfolded, writtenCount);

  // Track the view's width (debounced: a reflow re-lays out the score).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let timer = 0;
    let first = true;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(el.clientWidth), first ? 0 : 150);
      first = false;
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, []);

  // Load the score.
  const filesKey = `${files.mxlUrl}|${files.msczUrl ?? ''}|${files.modified ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setEngine(null);
    setGeometry(null);
    (async () => {
      try {
        const { xml, source } = await fetchSongScore(files);
        if (cancelled) return;
        try {
          structureRef.current = parseMusicXML(xml);
          setUnfolded(unfold(structureRef.current, { repeatAfterDcDs }));
        } catch (e) {
          console.warn('Repeat unfold failed; following the written order', e);
          structureRef.current = null;
          setUnfolded([]);
        }
        const e = await ScoreEngine.open(source, { mode: 'page' });
        if (cancelled) return;
        // The parts hidden in the strip are hidden here too.
        const saved = loadSheetMusicSongState(songId)?.hiddenPartIds ?? [];
        if (saved.length > 0) {
          const ids = scorePartIds(xml);
          const hidden = new Set(ids.flatMap((id, i) => (saved.includes(id) ? [i] : [])));
          if (hidden.size < e.parts().length) e.setHiddenParts(hidden);
        }
        setEngine(e);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('Page view failed to load', err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, songId]);

  // Re-run the unfold when the per-song repeat setting flips.
  useEffect(() => {
    if (!structureRef.current) return;
    try {
      setUnfolded(unfold(structureRef.current, { repeatAfterDcDs }));
    } catch (e) {
      console.warn('Repeat unfold re-run failed', e);
    }
  }, [repeatAfterDcDs]);

  // Lay out for the width, zoom and mode, and measure everything.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!engine || width <= 0 || !viewport) return;
    const mode = layoutMode === 'auto' ? (width < REFLOW_BELOW_PX ? 'fit-width' : 'page') : layoutMode;
    const usable = Math.max(100, width - 2 * GUTTER_PX);

    let scale: number;
    if (mode === 'fit-width') {
      scale = CSS_DPI * zoom;
      engine.relayout({ mode: 'fit-width', widthInches: usable / scale });
    } else {
      engine.relayout({ mode: 'page' });
      scale = Math.min(usable / engine.pageSize(0).width, MAX_FIT_SCALE) * zoom;
    }

    const pages: PageBox[] = [];
    let y = GUTTER_PX;
    let contentWidth = width;
    for (let p = 0; p < engine.pageCount(); p++) {
      const size = engine.pageSize(p);
      const w = Math.ceil(size.width * scale);
      const h = Math.ceil(size.height * scale);
      pages.push({ top: y, left: Math.max(GUTTER_PX, Math.round((width - w) / 2)), width: w, height: h });
      contentWidth = Math.max(contentWidth, w + 2 * GUTTER_PX);
      y += h + PAGE_GAP_PX;
    }

    const beats = engine.measureBeatStarts();
    const measures = engine.measureRects().map((r: MeasureRect | null, i): MeasureBox | null => {
      const page = r ? pages[r.page] : undefined;
      if (!r || !page) return null;
      const left = page.left + r.x * scale;
      const right = left + r.width * scale;
      const beatIn = beats[i];
      const beat = beatIn == null ? left : Math.min(right - 2, Math.max(left, page.left + beatIn * scale));
      return { left, top: page.top + r.y * scale, width: right - left, height: r.height * scale, beat };
    });

    setGeometry((old) => {
      // Remember the measure at the top of the view, to put it back after
      // (unless a zoom gesture already chose the one under the fingers).
      if (old && !anchorRef.current) anchorRef.current = anchorAt(old, viewport.scrollTop, viewport.scrollTop);
      return { mode, scale, pages, width: contentWidth, height: y, measures };
    });
  }, [engine, width, zoom, layoutMode]);

  // After a re-layout, put the measure that was in view back where it was.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (zoomLayerRef.current) zoomLayerRef.current.style.transform = '';
    if (!viewport || !geometry || !anchor) return;
    const box = geometry.measures[anchor.written];
    if (box) viewport.scrollTop = Math.max(0, box.top - anchor.viewY);
  }, [geometry]);

  // Draw the tiles near the view, one per frame; clear far ones.
  useEffect(() => {
    const viewport = viewportRef.current;
    const layer = pagesLayerRef.current;
    if (!engine || !geometry || !viewport || !layer) return;
    const dpr = window.devicePixelRatio || 1;
    const dpi = geometry.scale * dpr;
    const queue = new Set<HTMLElement>();
    let frame = 0;

    const draw = (el: HTMLElement) => {
      const p = Number(el.dataset.page);
      const t = Number(el.dataset.tile);
      const page = geometry.pages[p];
      if (!page) return;
      const h = Math.min(TILE_PX, page.height - t * TILE_PX);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(page.width * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.cssText = `display:block;width:${page.width}px;height:${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) engine.draw(ctx, p, dpi, { x: 0, y: Math.round(t * TILE_PX * dpr), width: canvas.width, height: canvas.height });
      el.replaceChildren(canvas);
      el.dataset.drawn = '1';
    };
    const pump = () => {
      frame = 0;
      const next = queue.values().next();
      if (next.done) return;
      queue.delete(next.value);
      draw(next.value);
      if (queue.size > 0) frame = requestAnimationFrame(pump);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) {
          if (el.dataset.drawn !== '1') queue.add(el);
        } else {
          queue.delete(el);
          if (el.dataset.drawn === '1') { el.replaceChildren(); delete el.dataset.drawn; }
        }
      }
      if (queue.size > 0 && !frame) frame = requestAnimationFrame(pump);
    }, { root: viewport, rootMargin: '150% 0px' });

    const tiles = Array.from(layer.querySelectorAll<HTMLElement>('[data-tile]'));
    for (const el of tiles) { el.replaceChildren(); delete el.dataset.drawn; io.observe(el); }
    return () => { io.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [engine, geometry]);

  // The cursor: the current measure from its first beat, and a line through it.
  const cursor = useMemo(() => {
    if (!geometry || !scorePosition || scorePosition === PAST_END) return null;
    const box = geometry.measures[scorePosition.writtenIndex];
    if (!box) return null;
    const right = box.left + box.width;
    return { box, right, lineX: box.beat + scorePosition.fraction * (right - box.beat) };
  }, [geometry, scorePosition]);

  // Follow: keep the current system in view, near the top, and near the end
  // of a measure make sure the next one played (even a repeat or jump) is too.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !geometry || !cursor || !scorePosition || scorePosition === PAST_END) return;
    if (followPaused) {
      if (playing && Date.now() - lastUserScrollRef.current > FOLLOW_RESUME_MS) setFollowPaused(false);
      return;
    }
    const vh = viewport.clientHeight;
    const top = viewport.scrollTop;
    const cur = cursor.box;
    let need = cur.top < top + 0.06 * vh || cur.top + cur.height > top + 0.94 * vh;
    if (!need && scorePosition.fraction > LOOKAHEAD_FRACTION) {
      const next = geometry.measures[writtenOf(scorePosition.playedIndex + 1, unfolded)];
      if (next && next.top !== cur.top && (next.top < top || next.top + next.height > top + vh)) need = true;
    }
    const targetTop = need ? Math.max(0, cur.top - 0.12 * vh) : top;

    // Pages wider than the view: keep the cursor across from the left third.
    const cw = viewport.clientWidth;
    const left = viewport.scrollLeft;
    const targetLeft = cursor.lineX < left + 40 || cursor.lineX > left + cw - 40
      ? Math.max(0, cursor.lineX - cw / 3)
      : left;

    if (targetTop !== top || targetLeft !== left) {
      viewport.scrollTo({ top: targetTop, left: targetLeft, behavior: 'smooth' });
    }
  }, [cursor, geometry, scorePosition, followPaused, playing, unfolded]);

  // Scrolling, swiping or wheeling pauses follow.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pause = () => { lastUserScrollRef.current = Date.now(); setFollowPaused(true); };
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) pause(); };
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) pause();
    };
    // A press on the scrollbar (outside the content box).
    const onPointerDown = (e: PointerEvent) => {
      if (e.offsetX > viewport.clientWidth || e.offsetY > viewport.clientHeight) pause();
    };
    viewport.addEventListener('wheel', onWheel, { passive: true });
    viewport.addEventListener('touchmove', pause, { passive: true });
    viewport.addEventListener('keydown', onKey);
    viewport.addEventListener('pointerdown', onPointerDown);
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchmove', pause);
      viewport.removeEventListener('keydown', onKey);
      viewport.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  // Zoom: ctrl/⌘ + wheel (also how trackpads report a pinch) and two-finger
  // pinch. The pages are scaled with CSS while the gesture lasts, and laid
  // out again at the new zoom when it ends.
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const geometryRef = useRef(geometry);
  useEffect(() => { geometryRef.current = geometry; }, [geometry]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let pending = 0;
    let commitTimer = 0;
    let originY = 0;
    const preview = (next: number, clientY: number) => {
      const layer = zoomLayerRef.current;
      const rect = viewport.getBoundingClientRect();
      originY = viewport.scrollTop + (clientY - rect.top);
      pending = next;
      if (layer) {
        layer.style.transformOrigin = `50% ${originY}px`;
        layer.style.transform = `scale(${next / zoomRef.current})`;
      }
    };
    const commit = () => {
      if (!pending) return;
      const next = pending;
      pending = 0;
      if (Math.abs(next - zoomRef.current) < 0.001) {
        // No change (e.g. at a limit): just drop the preview.
        if (zoomLayerRef.current) zoomLayerRef.current.style.transform = '';
        return;
      }
      // Keep the measure under the fingers (or pointer) where it is.
      const g = geometryRef.current;
      if (g) anchorRef.current = anchorAt(g, originY, viewport.scrollTop);
      setZoom(next);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const base = pending || zoomRef.current;
      preview(clampZoom(base * Math.exp(-e.deltaY * 0.01)), e.clientY);
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(commit, 200);
    };
    let startDist = 0;
    let startZoom = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { startDist = dist(e.touches); startZoom = zoomRef.current; }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      preview(clampZoom(startZoom * (dist(e.touches) / startDist)), midY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (startDist && e.touches.length < 2) { startDist = 0; commit(); }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd);
    viewport.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.clearTimeout(commitTimer);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [setZoom]);

  // Tap or click a measure to jump to its first time through.
  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pressRef.current = e.isPrimary ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    const layer = zoomLayerRef.current;
    if (!press || press.id !== e.pointerId || !layer || !geometry || !engine) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) return;
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const p = geometry.pages.findIndex((pg) => y >= pg.top && y < pg.top + pg.height && x >= pg.left && x < pg.left + pg.width);
    if (p < 0) return;
    const page = geometry.pages[p];
    const written = engine.measureAt(p, (x - page.left) / geometry.scale, (y - page.top) / geometry.scale);
    if (written < 0 || measureTimes.length === 0) return;
    const played = Math.min(firstPlayedIndex(written, unfolded), measureTimes.length - 1);
    audio.seek(measureTimes[played]);
    setFollowPaused(false);
  }, [geometry, engine, measureTimes, unfolded, audio]);

  const resumeFollow = useCallback(() => setFollowPaused(false), []);

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        tabIndex={0}
        className="h-full w-full overflow-auto bg-gray-700 outline-none"
        style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <div
          ref={zoomLayerRef}
          className="relative"
          style={{ width: geometry?.width ?? '100%', height: geometry?.height ?? '100%' }}
        >
          <div ref={pagesLayerRef} style={{ position: 'absolute', inset: 0, filter: invert ? 'invert(1) hue-rotate(180deg)' : undefined }}>
            {geometry?.pages.map((page, p) => (
              <div
                key={p}
                style={{
                  position: 'absolute',
                  left: page.left,
                  top: page.top,
                  width: page.width,
                  height: page.height,
                  background: '#fff',
                  boxShadow: geometry.mode === 'page' ? '0 1px 6px rgba(0,0,0,0.45)' : undefined,
                }}
              >
                {Array.from({ length: Math.ceil(page.height / TILE_PX) }, (_, t) => (
                  <div
                    key={t}
                    data-page={p}
                    data-tile={t}
                    style={{ position: 'absolute', left: 0, top: t * TILE_PX, width: page.width, height: Math.min(TILE_PX, page.height - t * TILE_PX) }}
                  />
                ))}
              </div>
            ))}
          </div>
          {cursor && (
            <>
              <div
                className="pointer-events-none absolute rounded-sm"
                style={{
                  left: cursor.box.beat - 4,
                  top: cursor.box.top,
                  width: cursor.right - cursor.box.beat + 4,
                  height: cursor.box.height,
                  background: 'rgba(34,211,238,0.14)',
                }}
              />
              <div
                className="pointer-events-none absolute"
                style={{
                  left: cursor.lineX - 1,
                  top: cursor.box.top,
                  width: 2,
                  height: cursor.box.height,
                  background: '#22D3EE',
                  boxShadow: '0 0 6px rgba(34,211,238,0.6)',
                }}
              />
            </>
          )}
        </div>
      </div>
      {followPaused && status === 'ready' && (
        <button
          onClick={resumeFollow}
          className="absolute bottom-3 right-3 rounded-full bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg hover:bg-cyan-500"
        >
          Follow
        </button>
      )}
      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
          {status === 'error' ? `Couldn't show this score: ${error}` : 'Loading score…'}
        </div>
      )}
    </div>
  );
}

function clampZoom(z: number): number {
  return Math.min(3, Math.max(0.5, z));
}

/**
 * The measure at content y `pickY` (the first whose box reaches past it), and
 * where its top sits in a view scrolled to `scrollTop`.
 */
function anchorAt(g: Geometry, pickY: number, scrollTop: number): Anchor | null {
  for (let i = 0; i < g.measures.length; i++) {
    const m = g.measures[i];
    if (m && m.top + m.height > pickY) return { written: i, viewY: m.top - scrollTop };
  }
  return null;
}
