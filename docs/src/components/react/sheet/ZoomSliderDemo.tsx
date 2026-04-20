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

/**
 * Widget 2 — Music size slider.
 *
 * Two ways to scale sheet music: (a) OSMD's native `osmd.zoom` which
 * triggers a real re-render with vector-clean glyphs at every size, and
 * (b) a CSS `transform: scale(...)` on the rendered SVG, which is
 * instant (no re-layout) but rasterizes text at the new size on each paint
 * and breaks cursor-offset math (scrolling jumps).
 *
 * We expose both so the reader can feel the difference. Default is OSMD
 * native, which is what we'll ship.
 */
export function ZoomSliderDemo({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [zoom, setZoom] = useState(0.9);
  const [cssScale, setCssScale] = useState(1.0);
  const [mode, setMode] = useState<'osmd' | 'css'>('osmd');
  const osmdRef = useRef<any>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const containerWrapRef = useRef<HTMLDivElement | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);

  const handleReady = useCallback((osmd: any) => {
    osmdRef.current = osmd;
    if (osmd?.container?.parentElement) {
      scrollHostRef.current = osmd.container.parentElement;
    }
  }, []);
  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);

  // Scroll sync — same math, just respects whichever scale is active
  useEffect(() => {
    if (timeline.length === 0 || !scrollHostRef.current) return;
    const scoreBeat = config ? secondsToBeat(currentTime + offsetSec, beatTimes, 120) : 0;
    const idx = findCursorIdx(scoreBeat, timeline);
    const stamp = timeline[idx];
    if (!stamp) return;
    const next = timeline[idx + 1];
    let xPx = stamp.xPx;
    if (next) {
      const dBeat = next.absoluteBeat - stamp.absoluteBeat;
      if (dBeat > 0) {
        const frac = Math.max(0, Math.min(1, (scoreBeat - stamp.absoluteBeat) / dBeat));
        xPx = stamp.xPx + frac * (next.xPx - stamp.xPx);
      }
    }
    // CSS scale multiplies the *visual* x, not the cursor's reported offsetLeft
    const effectiveX = mode === 'css' ? xPx * cssScale : xPx;
    const target = effectiveX - scrollHostRef.current.clientWidth * playheadFraction;
    scrollHostRef.current.scrollLeft = Math.max(0, target);
  }, [currentTime, timeline, beatTimes, config, mode, cssScale, offsetSec]);

  // CSS scale: directly mutate the SVG element
  useEffect(() => {
    const svg = containerWrapRef.current?.querySelector('svg');
    if (!svg) return;
    if (mode === 'css') {
      svg.style.transformOrigin = '0 0';
      svg.style.transform = `scale(${cssScale})`;
    } else {
      svg.style.transform = '';
    }
  }, [mode, cssScale, timeline]);

  // The renderer's internal zoom prop is set per render — bump key to force
  // remount when switching modes (so the SVG cleans up its style)
  const rendererKey = mode === 'osmd' ? `osmd-${zoom.toFixed(2)}` : 'css-base';
  const effectiveZoom = mode === 'osmd' ? zoom : 0.9;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem 1.4rem', marginBottom: '0.6rem', fontSize: '0.85em' }}>
        <label>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
            Mode
          </div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button onClick={() => setMode('osmd')} style={btn(mode === 'osmd')}>OSMD re-render</button>
            <button onClick={() => setMode('css')} style={btn(mode === 'css')}>CSS scale</button>
          </div>
        </label>
        {mode === 'osmd' ? (
          <label>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
              osmd.zoom · <strong>{(zoom * 100).toFixed(0)}%</strong>
            </div>
            <input type="range" min={0.4} max={2.0} step={0.05} value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: '100%' }} />
          </label>
        ) : (
          <label>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
              transform: scale · <strong>{(cssScale * 100).toFixed(0)}%</strong>
            </div>
            <input type="range" min={0.4} max={2.0} step={0.05} value={cssScale}
              onChange={(e) => setCssScale(parseFloat(e.target.value))} style={{ width: '100%' }} />
          </label>
        )}
      </div>
      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)}</span>
      </Toolbar>

      <div ref={containerWrapRef} style={{ position: 'relative' }}>
        <InfiniteScrollRenderer
          key={rendererKey}
          url={scoreUrl}
          height={mode === 'css' ? Math.max(180, 220 * cssScale + 20) : Math.max(160, 220 * effectiveZoom)}
          zoom={effectiveZoom}
          onReady={handleReady}
          onTimeline={handleTimeline}
        />
        <div style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${playheadFraction * 100}%`,
          width: 2,
          background: 'rgba(217, 70, 239, 0.85)',
          pointerEvents: 'none',
          boxShadow: '0 0 8px rgba(217,70,239,0.6)',
          zIndex: 5,
        }} />
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

      <p style={{ fontSize: '0.78em', color: 'var(--text-secondary)', marginTop: 8 }}>
        OSMD mode triggers a full re-render on each zoom change (~150–400 ms).
        CSS mode is instant but blurs text after upscaling and the playhead
        drifts (cursor x-positions don't account for the post-render scale).
      </p>
    </div>
  );
}
