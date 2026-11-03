/**
 * TEMPORARY (Phase 2 spike, dev builds only): renders a score with muse-encore
 * so it can be compared with OSMD and with MuseScore itself. Opens the current
 * song's score or a local .mscz / .mxl, as exact pages or reflowed to the
 * window width. Shows load and layout timings, outlines each measure, and
 * checks muse-encore's repeat order against ours (`unfold`). Replaced by the
 * real page view in Phase 4.
 */
import { useEffect, useRef, useState } from 'react';
import type { UnfoldedStep } from '../../../audio/unfoldRepeats';
import { scoreBytesToXml } from '../../../utils/safeUnzip';
import { ScoreEngine, type MeasureRect, type ScoreLayout, type ScoreSource } from './museEncoreEngine';

const CSS_DPI = 96;
const TILE_CSS_PX = 1024;
const PAGE_GAP_PX = 16;

interface Props {
  url: string;
  unfolded: UnfoldedStep[];
  /** Indices of the parts hidden in the strip. */
  hiddenPartIndices: number[];
  onClose: () => void;
}

interface Stats {
  fetchMs: number;
  fontsMs: number;
  importMs: number;
  layoutMs: number;
  drawMs: number;
  measures: number;
  missingRects: number;
  order: string;
}

type Origin = { kind: 'song' } | { kind: 'file'; file: File };

async function readSource(origin: Origin, url: string): Promise<ScoreSource> {
  const bytes = origin.kind === 'file'
    ? new Uint8Array(await origin.file.arrayBuffer())
    : new Uint8Array(await (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      return res.arrayBuffer();
    })());
  if (origin.kind === 'file' && /\.mscz$/i.test(origin.file.name)) return { kind: 'mscz', bytes };
  return { kind: 'musicxml', xml: scoreBytesToXml(bytes) };
}

export function ScorePageSpike({ url, unfolded, hiddenPartIndices, onClose }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<Origin>({ kind: 'song' });
  const [mode, setMode] = useState<'page' | 'fit-width'>('page');
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [engine, setEngine] = useState<ScoreEngine | null>(null);
  const [rects, setRects] = useState<(MeasureRect | null)[]>([]);
  const [pageTops, setPageTops] = useState<number[]>([]);
  const [stats, setStats] = useState<Partial<Stats>>({});
  const [error, setError] = useState<string | null>(null);
  const [outlines, setOutlines] = useState(false);
  const fetchMsRef = useRef(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = CSS_DPI * zoom;
  const layout: ScoreLayout | null = mode === 'page'
    ? { mode: 'page' }
    : width > 0 ? { mode: 'fit-width', widthInches: (width - 32) / scale } : null;
  const layoutKey = layout ? JSON.stringify(layout) : '';

  // Load whenever the source changes.
  useEffect(() => {
    if (!layout) return;
    let cancelled = false;
    setEngine(null);
    setError(null);
    (async () => {
      try {
        const t0 = performance.now();
        const source = await readSource(origin, url);
        fetchMsRef.current = performance.now() - t0;
        const e = await ScoreEngine.open(source, layout);
        if (cancelled) return;
        if (origin.kind === 'song') {
          e.setHiddenParts(new Set(hiddenPartIndices));
        }
        setEngine(e);
      } catch (err) {
        console.error('muse-encore spike failed', err);
        if (!cancelled) setError(String(err));
      }
    })();
    return () => { cancelled = true; };
    // Re-open only for a new source; layout changes re-lay out below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, url]);

  // Lay out and draw.
  useEffect(() => {
    const host = pagesRef.current;
    if (!engine || !host || !layout) return;
    engine.relayout(layout);
    const r = engine.measureRects();
    setRects(r);

    const dpr = window.devicePixelRatio || 1;
    const dpi = scale * dpr;
    host.replaceChildren();
    const tops: number[] = [];
    let y = 0;
    const t0 = performance.now();
    for (let page = 0; page < engine.pageCount(); page++) {
      const size = engine.pageSize(page);
      const widthCss = Math.ceil(size.width * scale);
      const heightCss = Math.ceil(size.height * scale);
      tops.push(y);
      const pageEl = document.createElement('div');
      pageEl.style.cssText = `width:${widthCss}px;margin:0 auto ${PAGE_GAP_PX}px;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
      for (let top = 0; top < heightCss; top += TILE_CSS_PX) {
        const h = Math.min(TILE_CSS_PX, heightCss - top);
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(widthCss * dpr);
        canvas.height = Math.ceil(h * dpr);
        canvas.style.cssText = `display:block;width:${widthCss}px;height:${h}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) engine.draw(ctx, page, dpi, { x: 0, y: top * dpr, width: canvas.width, height: canvas.height });
        pageEl.appendChild(canvas);
      }
      host.appendChild(pageEl);
      y += heightCss + PAGE_GAP_PX;
    }
    setPageTops(tops);
    const drawMs = performance.now() - t0;

    let order = 'n/a for local files';
    if (origin.kind === 'song') {
      const theirs = engine.playedOrder();
      const ours = unfolded.length > 0 ? unfolded.map((s) => s.srcIndex) : r.map((_, i) => i);
      const firstDiff = theirs.findIndex((v, i) => v !== ours[i]);
      order = firstDiff === -1 && theirs.length === ours.length
        ? `match (${ours.length} played)`
        : `DIFFER: ours ${ours.length} vs muse-encore ${theirs.length} played, first difference at step ${firstDiff === -1 ? Math.min(theirs.length, ours.length) : firstDiff}`;
    }

    const next: Stats = {
      fetchMs: fetchMsRef.current,
      ...engine.timings,
      drawMs,
      measures: r.length,
      missingRects: r.filter((x) => !x).length,
      order,
    };
    setStats(next);
    console.info('[muse-encore spike]', next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, layoutKey, scale, unfolded]);

  const fmt = (n?: number) => (n === undefined ? '…' : `${Math.round(n)} ms`);
  const pageWidthCss = engine ? engine.pageSize(0).width * scale : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gray-950 text-gray-200">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-800 px-3 py-2 text-xs">
        <strong className="text-sm">muse-encore spike</strong>
        <label className="flex items-center gap-1">
          source
          <select
            className="rounded bg-gray-800 px-1 py-0.5"
            value={origin.kind}
            onChange={(e) => { if (e.target.value === 'song') setOrigin({ kind: 'song' }); }}
          >
            <option value="song">this song's .mxl</option>
            {origin.kind === 'file' && <option value="file">{origin.file.name}</option>}
          </select>
        </label>
        <label className="cursor-pointer rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">
          open .mscz / .mxl…
          <input
            type="file"
            accept=".mscz,.mxl,.musicxml,.xml"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setOrigin({ kind: 'file', file: f }); e.target.value = ''; }}
          />
        </label>
        <label className="flex items-center gap-1">
          layout
          <select className="rounded bg-gray-800 px-1 py-0.5" value={mode} onChange={(e) => setMode(e.target.value as 'page' | 'fit-width')}>
            <option value="page">exact pages</option>
            <option value="fit-width">reflow to width</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          zoom
          <input type="range" min={0.5} max={2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          {Math.round(zoom * 100)}%
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} />
          outlines
        </label>
        <span>load {fmt(stats.fetchMs)}</span>
        <span>fonts {fmt(stats.fontsMs)}</span>
        <span>import {fmt(stats.importMs)}</span>
        <span>layout {fmt(stats.layoutMs)}</span>
        <span>draw {fmt(stats.drawMs)}</span>
        <span>{stats.measures ?? '…'} measures{stats.missingRects ? ` (${stats.missingRects} without bounds)` : ''}</span>
        <span className={stats.order?.startsWith('DIFFER') ? 'text-amber-400' : 'text-green-400'}>repeats: {stats.order ?? '…'}</span>
        <button onClick={onClose} className="ml-auto rounded bg-gray-800 px-2 py-1 hover:bg-gray-700">close</button>
      </div>
      <div ref={viewportRef} className="relative flex-1 overflow-auto bg-gray-600 p-4">
        {error && <div className="rounded bg-white p-4 text-red-600">Error: {error}</div>}
        {!engine && !error && <div className="rounded bg-white p-4 text-gray-600">Loading muse-encore…</div>}
        <div className="relative">
          <div ref={pagesRef} />
          {outlines && rects.map((r, i) => r && (
            <div
              key={i}
              className="pointer-events-none absolute border border-blue-500/50"
              style={{
                left: `calc(50% - ${pageWidthCss / 2}px + ${r.x * scale}px)`,
                top: (pageTops[r.page] ?? 0) + r.y * scale,
                width: r.width * scale,
                height: r.height * scale,
              }}
            >
              <span className="absolute left-0.5 top-0 text-[9px] text-blue-600">{i}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
