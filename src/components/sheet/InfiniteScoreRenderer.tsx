import { useEffect, useRef, useState } from 'react';
import { parseMusicXML, unfold, type UnfoldedStep } from '../../audio/unfoldRepeats';

export interface PartInfo {
  /** MusicXML part id (e.g. "P1") */
  id: string;
  /** Human-readable instrument name */
  name: string;
  /** 0-based index in the score's instrument list */
  index: number;
}

export interface InfiniteBeatStamp {
  /** Sequential cursor position from the osmd.cursor.next() walk */
  index: number;
  /** 0-based measure index */
  measureIndex: number;
  /** Quarter-note offset within the measure */
  beatInMeasure: number;
  /** Absolute quarter-note offset from the start of the score */
  absoluteBeat: number;
  /** Cursor element offsetLeft at this position, in scroll-host content px */
  xPx: number;
  /** Distance to the next cursor step (px). Used as a default bbox width. */
  widthPx: number;
}

interface Props {
  /** MusicXML URL to load */
  url: string;
  /** CSS height of the scrolling viewport */
  height?: number;
  /** OSMD zoom factor (1 = 100%) */
  zoom?: number;
  /** Force every measure to the widest measure's required width */
  equalBeatWidth?: boolean;
  /**
   * Fixed pixel width of the blank leading space before the first note,
   * matching the playhead position so beat 0 can sit under it at t=0.
   * Must be fixed (not a viewport fraction) — a percent-width spacer
   * shrinks on resize and shifts every `measureXs` value, leaving the
   * playhead / bbox snapped to the wrong measure.
   */
  leadingPadPx?: number;
  onReady?: (osmd: any) => void;
  onTimeline?: (timeline: InfiniteBeatStamp[]) => void;
  onMeasureXs?: (xs: number[]) => void;
  /** Fires after each (re)render with the live SVG element, or `null` on
   *  unmount / failure. Callers can clone it for sticky-preamble overlays. */
  onSvgReady?: (svg: SVGSVGElement | null) => void;
  /** Fires once per load with the discovered instrument parts. */
  onParts?: (parts: PartInfo[]) => void;
  /** Fires once per load with the unfolded playback order derived from the
   *  MusicXML's repeat / volta / D.C. / D.S. / coda / Fine markers. An empty
   *  array means "no repeats detected" — callers should fall back to
   *  written-measure-indexed math. */
  onUnfoldedOrder?: (steps: UnfoldedStep[]) => void;
  /** Set of part ids that should render. When undefined or empty, all
   *  parts render. Changes are applied by mutating each instrument's
   *  `Visible` flag and re-rendering without a full reload. */
  visiblePartIds?: Set<string>;
  /** Children rendered absolutely-positioned inside the scroll host so they
   *  scroll natively with the score. Use for playhead / bbox / overlays. */
  overlay?: React.ReactNode;
}

/**
 * OSMD wrapper configured for one continuous horizontal staffline. Ported
 * from the docs-site prototype at
 * `docs/src/components/react/sheet/InfiniteScrollRenderer.tsx`.
 *
 * Three knobs that matter for "single-line" mode:
 *  - `drawingParameters: 'compacttight'` — dense layout
 *  - `renderSingleHorizontalStaffline: true` — disable line wrapping
 *  - `EngravingRules.NewSystemAtXMLNewSystemAttribute = false` — ignore
 *    `<print new-system>` hints from the source XML
 *  - `EngravingRules.SheetMaximumWidth` — raise for long pieces (default
 *    32767 SVG limit)
 */
export function InfiniteScoreRenderer({
  url,
  height = 220,
  zoom = 1.0,
  equalBeatWidth = false,
  leadingPadPx = 180,
  onReady,
  onTimeline,
  onMeasureXs,
  onSvgReady,
  onParts,
  onUnfoldedOrder,
  visiblePartIds,
  overlay,
}: Props) {
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null);
  const partsRef = useRef<PartInfo[]>([]);
  /** Sorted join of the last-applied visible-part ids. Used to skip the
   *  visibility effect when the Set content is unchanged (a fresh Set
   *  instance from the parent wouldn't otherwise be detected as equal). */
  const lastVisibilityKeyRef = useRef<string>('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendering' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

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
          try { osmdRef.current.clear(); } catch { /* ignore */ }
          osmdRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: false,
          backend: 'svg',
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawPartNames: false,
          drawingParameters: 'compacttight',
          followCursor: false,
          renderSingleHorizontalStaffline: true,
        });

        const er = osmd.EngravingRules;
        er.NewSystemAtXMLNewSystemAttribute = false;
        er.NewPageAtXMLNewPageAttribute = false;
        er.RenderSingleHorizontalStaffline = true;
        er.SheetMaximumWidth = 100000;
        er.PageLeftMargin = 2;
        er.PageRightMargin = 2;
        er.FixedMeasureWidth = !!equalBeatWidth;

        // MXL files are ZIP archives (compressed MusicXML). We fetch as
        // arrayBuffer, detect zip via the PK magic bytes, and — if zipped
        // — unzip here so we can both (a) parse the inner XML ourselves
        // for repeat-unfolding and (b) feed OSMD a plain XML string. Plain
        // .xml / .musicxml files take the decode-as-UTF-8 path directly.
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
        let xmlText: string;
        if (isZip) {
          // Dynamic-import JSZip so it only loads for MXL scores.
          const JSZipMod = await import('jszip');
          const JSZip = JSZipMod.default ?? JSZipMod;
          const zip = await JSZip.loadAsync(buf);
          const container = zip.file('META-INF/container.xml');
          let rootPath: string | null = null;
          if (container) {
            const containerText = await container.async('string');
            const cdoc = new DOMParser().parseFromString(containerText, 'application/xml');
            rootPath = cdoc.querySelector('rootfile')?.getAttribute('full-path') ?? null;
          }
          const scoreFile = (rootPath && zip.file(rootPath))
            || zip.file(/\.xml$/i)[0]
            || null;
          if (!scoreFile) throw new Error('No score XML inside MXL');
          xmlText = await scoreFile.async('string');
        } else {
          xmlText = new TextDecoder('utf-8').decode(bytes);
        }
        if (cancelled) return;
        await osmd.load(xmlText);
        osmd.zoom = zoom;

        // Parse repeat/jump structure from the same XML text and unfold it
        // into a linear playback order. Harmless on scores without repeats
        // — `unfold` just returns the same measure order.
        let unfoldedSteps: UnfoldedStep[] = [];
        try {
          const structure = parseMusicXML(xmlText);
          unfoldedSteps = unfold(structure);
        } catch (e) {
          console.warn('Repeat unfold failed; falling back to linear order', e);
          unfoldedSteps = [];
        }

        // Discover parts and apply any pre-existing visibility selection
        // BEFORE the first render so we don't waste a render-with-all pass.
        const instruments: any[] = osmd.Sheet?.Instruments ?? [];
        const partList: PartInfo[] = instruments.map((inst, i) => ({
          id: inst.IdString ?? `P${i + 1}`,
          name: inst.Name ?? inst.NameLabel?.text ?? `Part ${i + 1}`,
          index: i,
        }));
        partsRef.current = partList;
        if (visiblePartIds && visiblePartIds.size > 0) {
          instruments.forEach((inst, i) => {
            inst.Visible = visiblePartIds.has(partList[i].id);
          });
          lastVisibilityKeyRef.current = Array.from(visiblePartIds).sort().join('|');
        } else {
          lastVisibilityKeyRef.current = partList.map((p) => p.id).sort().join('|');
        }

        setStatus('rendering');
        osmd.render();
        if (cancelled) return;
        osmdRef.current = osmd;
        osmd.cursor.show();

        const timeline = buildBeatTimeline(osmd, scrollHostRef.current);
        onTimeline?.(timeline);
        const measureXs = buildMeasureStartXs(timeline);
        onMeasureXs?.(measureXs);
        onSvgReady?.(containerRef.current?.querySelector('svg') ?? null);
        onParts?.(partList);
        onUnfoldedOrder?.(unfoldedSteps);

        setStatus('ready');
        onReady?.(osmd);
      } catch (err) {
        if (cancelled) return;
        console.error('InfiniteScoreRenderer failed', err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, equalBeatWidth]);

  // Live zoom updates without a full reload
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready') return;
    if (Math.abs(osmd.zoom - zoom) < 0.001) return;
    osmd.zoom = zoom;
    try {
      osmd.render();
      osmd.cursor.show();
      const tl = buildBeatTimeline(osmd, scrollHostRef.current);
      onTimeline?.(tl);
      const mxs = buildMeasureStartXs(tl);
      onMeasureXs?.(mxs);
      onSvgReady?.(containerRef.current?.querySelector('svg') ?? null);
    } catch (e) {
      console.warn('zoom re-render failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Live part-visibility updates without a full reload. Mutating
  // `inst.Visible` and re-rendering is an OSMD-supported fast path — it
  // re-runs layout on the already-parsed score instead of re-fetching
  // XML. The measureXs/timeline are rebuilt so the playhead / window /
  // bbox math stays in sync with the new layout width.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready') return;
    const parts = partsRef.current;
    if (parts.length === 0) return;
    const effective = visiblePartIds && visiblePartIds.size > 0
      ? visiblePartIds
      : new Set(parts.map((p) => p.id));
    const key = Array.from(effective).sort().join('|');
    if (key === lastVisibilityKeyRef.current) return;
    const instruments: any[] = osmd.Sheet?.Instruments ?? [];
    instruments.forEach((inst, i) => {
      const id = parts[i]?.id;
      inst.Visible = id ? effective.has(id) : true;
    });
    try {
      osmd.render();
      osmd.cursor.show();
      const tl = buildBeatTimeline(osmd, scrollHostRef.current);
      onTimeline?.(tl);
      const mxs = buildMeasureStartXs(tl);
      onMeasureXs?.(mxs);
      onSvgReady?.(containerRef.current?.querySelector('svg') ?? null);
      lastVisibilityKeyRef.current = key;
    } catch (e) {
      console.warn('visibility re-render failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePartIds, status]);

  // `height` is a minimum only during loading/error so the placeholder
  // has something to fill. Once the score is rendered, the host
  // auto-sizes to the SVG so a single-staff score takes up a single
  // staff's worth of vertical space (rather than the fixed 180px floor
  // that was visible even when only one part was shown).
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
      <div ref={containerRef} style={{ display: 'inline-block', verticalAlign: 'top' }} />
      {/* Trailing pad — fixed pixel width so the last measure can always
          scroll to the focus point regardless of viewport. */}
      <div style={{ display: 'inline-block', width: 800, height: 1, verticalAlign: 'top' }} aria-hidden />
      {overlay && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, pointerEvents: 'none', zIndex: 3 }}>
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
  );
}

/**
 * Walk the OSMD cursor through every step and record measure/beat/x positions.
 * `scrollHost` is used to translate cursor rects into scroll-host content
 * coordinates via `getBoundingClientRect`, so xPx values are robust to OSMD
 * setting the cursor's offsetParent to its own container (which would
 * otherwise ignore sibling spacers / padding).
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
  osmd.cursor.reset();
  osmd.cursor.show();
  return out;
}

/**
 * For each measure, return its left-barline x in scroll-host content px.
 * Strategy: derive from the cursor timeline, not the rendered SVG. For
 * measure M, take a 30/70 weighted midpoint between the last onset of
 * M-1 and the first onset of M. The weighting favors the first onset
 * because OSMD leaves more padding to the right of a notehead than to
 * its left, so the barline sits closer to the next measure's first
 * note. Previous attempts via `PositionAndShape.AbsolutePosition.x`
 * (unit conversion was unreliable) and via SVG DOM scans (OSMD renders
 * staff lines and barlines as composite paths, individual barlines
 * aren't addressable nodes) are documented in the docs-site blog.
 */
export function buildMeasureStartXs(timeline: InfiniteBeatStamp[]): number[] {
  if (timeline.length === 0) return [];
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
  const LEAD_GAP_PX = 10;
  out.push((firstByMeasure.get(0) ?? 0) - LEAD_GAP_PX);
  for (let m = 1; m <= maxMeasure; m++) {
    const prevLast = lastByMeasure.get(m - 1);
    const curFirst = firstByMeasure.get(m);
    if (prevLast == null || curFirst == null) {
      out.push(curFirst ?? prevLast ?? 0);
      continue;
    }
    out.push(0.3 * prevLast + 0.7 * curFirst);
  }
  // Right barline of the final written measure. `timeline[timeline.length - 1]`
  // isn't reliable here: OSMD's cursor walks in UNFOLDED order, so a score
  // with D.C. al Fine / al Coda terminates the cursor mid-score and the
  // last timeline xPx ends up at the Fine measure — producing a final
  // `measureXs` entry that's SMALLER than its predecessor. Instead, extend
  // past the last bar's left-edge by the average bar width observed so far.
  const firstBarX = out[0];
  const lastBarX = out[out.length - 1];
  const avgBarWidth = maxMeasure > 0 ? (lastBarX - firstBarX) / maxMeasure : 120;
  out.push(lastBarX + Math.max(avgBarWidth, 40));
  return out;
}

/** Look up the audio-time of every measure start in a timeline (by first
 *  onset per measureIndex). This isn't directly used by ScrollingScore
 *  (which uses tapMap-based measure times), but is exported for utility. */
export function firstOnsetXByMeasure(timeline: InfiniteBeatStamp[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const s of timeline) {
    if (seen.has(s.measureIndex)) continue;
    seen.add(s.measureIndex);
    out[s.measureIndex] = s.xPx;
  }
  return out;
}
