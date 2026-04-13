import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePeaks } from '@app/admin/utils/stemPeaks';
import { AlignmentPlayback } from '@app/admin/utils/alignmentPlayback';

interface Sample {
  id: string;
  label: string;
  color: string;
  path: string;
}

const SAMPLES: Sample[] = [
  { id: 'drm', label: 'DRM', color: '#ef4444', path: '/audio-samples/10s/DRM-10s.wav' },
  { id: 'sooza', label: 'Sooza', color: '#22c55e', path: '/audio-samples/10s/Sooza-10s.wav' },
  { id: 'click', label: 'Click', color: '#eab308', path: '/audio-samples/10s/Gunk Palace -  CLICK-10s.mp3' },
  { id: 'guide', label: 'Guide', color: '#3b82f6', path: '/audio-samples/10s/Gunk Palace -  GUIDE-10s.mp3' },
];

interface Loaded {
  id: string;
  buffer: AudioBuffer;
  peaks: Float32Array;
}

interface StemUI {
  id: string;
  offsetSec: number;
  muted: boolean;
  soloed: boolean;
}

const BUCKET_COUNT = 2048;
const ROW_HEIGHT = 72;
const OFFSET_MIN = -2;
const OFFSET_MAX = 4;
const MIN_ZOOM_SPAN = 0.05; // 50ms minimum visible span
const ZOOM_STEP = 1.15;

function fmtTime(s: number): string {
  const sign = s < 0 ? '-' : '';
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = (abs % 60).toFixed(2).padStart(5, '0');
  return `${sign}${m}:${sec}`;
}

function drawRow(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  color: string,
  bufferDuration: number,
  offsetSec: number,
  viewStart: number,
  viewEnd: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const bucketCount = peaks.length / 2;
  const viewSpan = viewEnd - viewStart;
  const pxPerSec = cssWidth / viewSpan;
  const stemStartPx = (offsetSec - viewStart) * pxPerSec;
  const stemWidthPx = bufferDuration * pxPerSec;
  const centerY = cssHeight / 2;
  const halfH = cssHeight / 2 - 2;

  ctx.fillStyle = color;
  for (let px = 0; px < cssWidth; px++) {
    const relativeStemPx = px - stemStartPx;
    if (relativeStemPx < 0 || relativeStemPx >= stemWidthPx) continue;
    const bucketIndex = Math.floor((relativeStemPx / stemWidthPx) * bucketCount);
    const min = peaks[bucketIndex * 2];
    const max = peaks[bucketIndex * 2 + 1];
    const y1 = centerY + min * halfH;
    const y2 = centerY + max * halfH;
    ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
  }

  // Center guideline
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(cssWidth, centerY);
  ctx.stroke();
}

export function StemAlignmentSandbox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [stems, setStems] = useState<StemUI[]>(
    SAMPLES.map((s) => ({ id: s.id, offsetSec: 0, muted: false, soloed: false })),
  );
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(10);

  const engineRef = useRef<AlignmentPlayback | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const rowsContainerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const userZoomedRef = useRef(false);

  // Total span = longest (offset + duration) across stems
  const spanSec = useMemo(() => {
    let max = 0;
    for (const s of stems) {
      const l = loaded.find((x) => x.id === s.id);
      if (!l) continue;
      max = Math.max(max, s.offsetSec + l.buffer.duration);
    }
    return Math.max(max, 1);
  }, [stems, loaded]);

  // Auto-fit the view to the full span until the user zooms manually
  useEffect(() => {
    if (!userZoomedRef.current) {
      setViewStart(0);
      setViewEnd(spanSec);
    } else {
      // Clamp the current view to new bounds if span shrank
      setViewEnd((prev) => Math.min(prev, spanSec));
      setViewStart((prev) => Math.max(0, Math.min(prev, spanSec - MIN_ZOOM_SPAN)));
    }
  }, [spanSec]);

  // Fetch + decode + compute peaks on mount
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    setLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          SAMPLES.map(async (s) => {
            const resp = await fetch(s.path);
            if (!resp.ok) throw new Error(`Fetch failed for ${s.path}: ${resp.status}`);
            const bytes = await resp.arrayBuffer();
            const buffer = await ctx.decodeAudioData(bytes);
            const peaks = computePeaks(buffer, BUCKET_COUNT);
            return { id: s.id, buffer, peaks };
          }),
        );
        if (cancelled) return;
        setLoaded(results);
        const engine = new AlignmentPlayback(ctx);
        engine.load(
          results.map((r) => ({
            id: r.id,
            buffer: r.buffer,
            offsetSec: 0,
          })),
        );
        engineRef.current = engine;
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      engineRef.current?.destroy();
      engineRef.current = null;
      ctx.close().catch(() => {});
    };
  }, []);

  // Playhead rAF loop
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        const p = e.getPosition();
        if (p >= e.duration) {
          e.pause();
          setPlaying(false);
          setPosition(0);
          e.seek(0);
          return;
        }
        setPosition(p);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  // Redraw waveforms whenever relevant inputs change
  useEffect(() => {
    for (const s of SAMPLES) {
      const l = loaded.find((x) => x.id === s.id);
      const canvas = canvasRefs.current[s.id];
      if (!l || !canvas) continue;
      const ui = stems.find((x) => x.id === s.id)!;
      drawRow(canvas, l.peaks, s.color, l.buffer.duration, ui.offsetSec, viewStart, viewEnd);
    }
  }, [loaded, stems, viewStart, viewEnd]);

  // Non-passive wheel listener on the rows container for cmd/ctrl + scroll zoom
  useEffect(() => {
    const container = rowsContainerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // Find the canvas under the pointer to compute cursor-relative position
      const firstCanvas = Object.values(canvasRefs.current).find(Boolean);
      if (!firstCanvas) return;
      const rect = firstCanvas.getBoundingClientRect();
      const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const frac = relX / rect.width;

      setViewStart((vs) => {
        const ve = viewEndRef.current;
        const currentSpan = ve - vs;
        const cursorSec = vs + frac * currentSpan;
        const zoomFactor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const newSpan = Math.max(MIN_ZOOM_SPAN, Math.min(spanSecRef.current, currentSpan * zoomFactor));
        let newStart = cursorSec - frac * newSpan;
        let newEnd = newStart + newSpan;
        // Clamp within [0, spanSec]
        if (newStart < 0) {
          newStart = 0;
          newEnd = newSpan;
        }
        if (newEnd > spanSecRef.current) {
          newEnd = spanSecRef.current;
          newStart = Math.max(0, newEnd - newSpan);
        }
        userZoomedRef.current = newSpan < spanSecRef.current - 0.001;
        setViewEnd(newEnd);
        return newStart;
      });
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => {
      container.removeEventListener('wheel', handler);
    };
  }, []);

  // Refs that mirror state, so the wheel handler (mounted once) sees current values
  const viewEndRef = useRef(viewEnd);
  const spanSecRef = useRef(spanSec);
  useEffect(() => {
    viewEndRef.current = viewEnd;
  }, [viewEnd]);
  useEffect(() => {
    spanSecRef.current = spanSec;
  }, [spanSec]);

  const togglePlay = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    if (playing) {
      e.pause();
      setPosition(e.getPosition());
      setPlaying(false);
    } else {
      await e.play();
      setPlaying(true);
    }
  }, [playing]);

  const seekTo = useCallback((sec: number) => {
    const e = engineRef.current;
    if (!e) return;
    e.seek(sec);
    setPosition(sec);
  }, []);

  const updateStem = useCallback((id: string, patch: Partial<StemUI>) => {
    setStems((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const e = engineRef.current;
    if (!e) return;
    if (patch.offsetSec !== undefined) e.setOffset(id, patch.offsetSec);
    if (patch.muted !== undefined) e.setMuted(id, patch.muted);
    if (patch.soloed !== undefined) e.setSoloed(id, patch.soloed);
  }, []);

  const resetZoom = () => {
    userZoomedRef.current = false;
    setViewStart(0);
    setViewEnd(spanSec);
  };

  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    seekTo(Math.max(0, Math.min(spanSec, frac * spanSec)));
  };

  const viewSpan = viewEnd - viewStart;
  const playheadInViewFrac = viewSpan > 0 ? (position - viewStart) / viewSpan : 0;
  const playheadVisible = playheadInViewFrac >= 0 && playheadInViewFrac <= 1;

  if (error) {
    return (
      <div style={{ padding: '1rem', background: '#2a1414', color: '#fca5a5', borderRadius: 8 }}>
        Failed to load samples: {error}
      </div>
    );
  }

  return (
    <div style={{ background: '#111827', color: '#e5e7eb', padding: '1rem', borderRadius: 8, fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={togglePlay}
          disabled={loading}
          style={{
            padding: '0.4rem 0.9rem',
            background: playing ? '#dc2626' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {loading ? 'Loading…' : playing ? 'Pause' : 'Play'}
        </button>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: '#9ca3af' }}>
          {fmtTime(position)} / {fmtTime(spanSec)}
        </span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          view: {fmtTime(viewStart)}–{fmtTime(viewEnd)} ({viewSpan.toFixed(2)}s)
        </span>
        <button
          onClick={resetZoom}
          disabled={!userZoomedRef.current}
          style={{
            padding: '2px 8px',
            background: '#374151',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: userZoomedRef.current ? 'pointer' : 'default',
            fontSize: 12,
            opacity: userZoomedRef.current ? 1 : 0.4,
          }}
        >
          Reset zoom
        </button>
        <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 'auto' }}>
          Cmd/Ctrl + scroll over a waveform to zoom
        </span>
      </div>

      {/* Timeline scrubber (full-span; click to seek) */}
      <div
        onClick={onTimelineClick}
        style={{
          height: 8,
          background: '#1f2937',
          borderRadius: 4,
          marginBottom: 10,
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: 2,
            background: '#f3f4f6',
            left: `${(position / spanSec) * 100}%`,
          }}
        />
        {/* Viewport indicator */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            background: 'rgba(59,130,246,0.25)',
            left: `${(viewStart / spanSec) * 100}%`,
            width: `${(viewSpan / spanSec) * 100}%`,
            pointerEvents: 'none',
          }}
        />
      </div>

      <div ref={rowsContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SAMPLES.map((s) => {
          const ui = stems.find((x) => x.id === s.id)!;
          const l = loaded.find((x) => x.id === s.id);
          return (
            <div key={s.id} style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: s.color,
                    display: 'inline-block',
                  }}
                />
                <span style={{ minWidth: 60, fontWeight: 500 }}>{s.label}</span>
                <button
                  onClick={() => updateStem(s.id, { muted: !ui.muted })}
                  style={{
                    padding: '2px 8px',
                    background: ui.muted ? '#dc2626' : '#374151',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  title="Mute"
                >
                  M
                </button>
                <button
                  onClick={() => updateStem(s.id, { soloed: !ui.soloed })}
                  style={{
                    padding: '2px 8px',
                    background: ui.soloed ? '#eab308' : '#374151',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                  title="Solo"
                >
                  S
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 12 }}>
                  offset
                  <input
                    type="range"
                    min={OFFSET_MIN}
                    max={OFFSET_MAX}
                    step={0.01}
                    value={ui.offsetSec}
                    onChange={(e) => updateStem(s.id, { offsetSec: parseFloat(e.target.value) })}
                    style={{ width: 140 }}
                  />
                  <input
                    type="number"
                    step={1}
                    min={OFFSET_MIN * 1000}
                    max={OFFSET_MAX * 1000}
                    value={Math.round(ui.offsetSec * 1000)}
                    onChange={(e) => {
                      const ms = parseFloat(e.target.value);
                      if (!Number.isFinite(ms)) return;
                      updateStem(s.id, { offsetSec: ms / 1000 });
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{
                      width: 64,
                      padding: '2px 6px',
                      background: '#0b1220',
                      color: '#e5e7eb',
                      border: '1px solid #374151',
                      borderRadius: 4,
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      textAlign: 'right',
                    }}
                  />
                  <span style={{ color: '#6b7280' }}>ms</span>
                </label>
              </div>
              <div
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const frac = (e.clientX - rect.left) / rect.width;
                  const sec = viewStart + frac * (viewEnd - viewStart);
                  seekTo(Math.max(0, Math.min(spanSec, sec)));
                }}
                style={{
                  position: 'relative',
                  height: ROW_HEIGHT,
                  background: '#020617',
                  borderRadius: 4,
                  overflow: 'hidden',
                  cursor: 'text',
                }}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[s.id] = el;
                  }}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
                {l && playheadVisible && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: 'rgba(243,244,246,0.85)',
                      pointerEvents: 'none',
                      left: `${playheadInViewFrac * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
