import { useEffect, useRef, useState } from 'react';

interface Props {
  /** URL of a .musicxml or .mxl file */
  url: string;
  /** Optional fixed height for the rendered area */
  height?: number;
  /** When true, draw the cursor (default false) */
  showCursor?: boolean;
  /** Notify the parent when render completes; passes the OSMD instance */
  onReady?: (osmd: any) => void;
  /** Notify the parent when measure timestamps are available */
  onTimeline?: (timeline: BeatStamp[]) => void;
}

export interface BeatStamp {
  index: number;          // sequential cursor position
  measureIndex: number;   // 0-based measure index
  beatInMeasure: number;  // quarter-note offset within measure
  absoluteBeat: number;   // running quarter-note offset from start
}

export function OsmdRenderer({ url, height = 360, showCursor = false, onReady, onTimeline }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'rendering' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!containerRef.current) return;
      setStatus('loading');
      setError(null);
      try {
        // Lazy import — opensheetmusicdisplay weighs ~1.5MB and pulls in vexflow
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;

        // Tear down any previous instance — strict mode runs effects twice in dev
        if (osmdRef.current) {
          try { osmdRef.current.clear(); } catch (_) { /* ignore */ }
          osmdRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: false,           // we handle resize ourselves below
          backend: 'svg',
          drawTitle: true,
          drawComposer: true,
          drawPartNames: true,
          drawingParameters: 'compact',
          followCursor: false,         // we drive scrolling ourselves
        });

        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
          return r.text();
        });
        if (cancelled) return;
        await osmd.load(text);

        setStatus('rendering');
        const t0 = performance.now();
        osmd.render();
        const dt = performance.now() - t0;
        if (cancelled) return;
        setRenderMs(dt);
        osmdRef.current = osmd;

        if (showCursor) {
          osmd.cursor.show();
        }

        // Build a beat-timeline so the parent can map seconds → cursor index
        if (onTimeline) {
          const timeline = buildTimeline(osmd);
          onTimeline(timeline);
        }

        setStatus('ready');
        onReady?.(osmd);
      } catch (err) {
        if (cancelled) return;
        console.error('OSMD render failed', err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, showCursor, onReady, onTimeline]);

  // Debounced resize: re-render when the container width changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (Math.abs(w - lastW) < 8) return;     // ignore subpixel jitter
      lastW = w;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (osmdRef.current && status === 'ready') {
          try { osmdRef.current.render(); } catch (e) { console.warn('re-render failed', e); }
        }
      }, 250);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, [status]);

  return (
    <div>
      <div style={{
        position: 'relative',
        height,
        overflow: 'auto',
        background: '#fff',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}>
        <div ref={containerRef} style={{ minHeight: height }} />
        {status !== 'ready' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            background: 'rgba(255,255,255,0.6)',
          }}>
            {status === 'error' ? `Error: ${error}` : `${status}…`}
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
        OSMD · {status}{renderMs ? ` · render ${renderMs.toFixed(0)}ms` : ''}
      </div>
    </div>
  );
}

/**
 * Walk the OSMD cursor once and record measure/beat positions.
 *
 * OSMD's iterator exposes `currentTimeStamp` (a Fraction) which is the
 * absolute position from the start of the score in whole notes. Multiplying
 * by 4 gives quarter-note ("beat") units.
 */
function buildTimeline(osmd: any): BeatStamp[] {
  const out: BeatStamp[] = [];
  osmd.cursor.reset();
  let safety = 10000;
  let i = 0;
  while (!osmd.cursor.iterator.EndReached && safety-- > 0) {
    const it = osmd.cursor.iterator;
    const measureIndex = it.CurrentMeasureIndex ?? it.currentMeasureIndex ?? 0;
    const ts = it.currentTimeStamp || it.CurrentTimeStamp;
    const absWhole = ts ? ts.RealValue ?? ts.realValue ?? 0 : 0;
    const absoluteBeat = absWhole * 4; // quarter notes
    // approximate beat-in-measure by subtracting measure-start absolute beat
    let beatInMeasure = 0;
    const measureStart = out.find((b) => b.measureIndex === measureIndex);
    if (measureStart) {
      beatInMeasure = absoluteBeat - measureStart.absoluteBeat;
    }
    out.push({ index: i++, measureIndex, beatInMeasure, absoluteBeat });
    osmd.cursor.next();
  }
  osmd.cursor.reset();
  return out;
}
