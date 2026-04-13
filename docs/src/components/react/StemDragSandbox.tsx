/**
 * Minimal sandbox to refine the drag + keyboard-nudge interactions
 * that will live inside AlignmentStep. Two stems, no zoom, no
 * mute/solo, no transport flash — just what's needed to feel
 * the gesture.
 *
 * Drag a row horizontally to change its offset. Click a row to focus
 * it, then arrow-nudge:
 *   ←/→              ±1 ms
 *   shift + ←/→      ±10 ms
 *   alt/opt + ←/→    ±100 ms
 */
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
  { id: 'click', label: 'Click', color: '#eab308', path: '/audio-samples/10s/Gunk Palace -  CLICK-10s.mp3' },
  { id: 'drm', label: 'Drums', color: '#ef4444', path: '/audio-samples/10s/DRM-10s.wav' },
];

interface Loaded {
  id: string;
  buffer: AudioBuffer;
  peaks: Float32Array;
}

const BUCKET_COUNT = 2048;
const ROW_HEIGHT = 64;
const NUDGE_MS = 1;
const SHIFT_NUDGE_MS = 10;
const ALT_NUDGE_MS = 100;

function fmtMs(sec: number): string {
  const ms = Math.round(sec * 1000);
  return `${ms >= 0 ? '+' : ''}${ms}ms`;
}

function drawRow(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
  color: string,
  bufferDuration: number,
  offsetSec: number,
  viewSpan: number,
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
  const pxPerSec = cssWidth / viewSpan;
  const stemStartPx = offsetSec * pxPerSec;
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

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(cssWidth, centerY);
  ctx.stroke();

  // t=0 marker
  const zeroPx = -offsetSec * 0; // will be drawn on the parent overlay instead; noop here
  void zeroPx;
}

export function StemDragSandbox() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [offsets, setOffsets] = useState<Record<string, number>>(() =>
    Object.fromEntries(SAMPLES.map((s) => [s.id, 0])),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const engineRef = useRef<AlignmentPlayback | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const dragRef = useRef<{ id: string; startClientX: number; startOffsetSec: number; pxPerSec: number } | null>(null);

  // Span = longest buffer duration, locked at load time. Offsets shift
  // waveforms within this fixed scale — dragging clips content off-screen
  // rather than rescaling everything.
  const viewSpan = useMemo(() => {
    let max = 0;
    for (const l of loaded) max = Math.max(max, l.buffer.duration);
    return Math.max(max, 1);
  }, [loaded]);

  // Load + decode + peaks
  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    (async () => {
      try {
        const results = await Promise.all(
          SAMPLES.map(async (s) => {
            const resp = await fetch(s.path);
            if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
            const bytes = await resp.arrayBuffer();
            const buffer = await ctx.decodeAudioData(bytes);
            const peaks = computePeaks(buffer, BUCKET_COUNT);
            return { id: s.id, buffer, peaks };
          }),
        );
        if (cancelled) return;
        setLoaded(results);
        const engine = new AlignmentPlayback(ctx);
        engine.load(results.map((r) => ({ id: r.id, buffer: r.buffer, offsetSec: 0 })));
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

  // Redraw on state change
  useEffect(() => {
    for (const s of SAMPLES) {
      const canvas = canvasRefs.current[s.id];
      const l = loaded.find((x) => x.id === s.id);
      if (!canvas || !l) continue;
      drawRow(canvas, l.peaks, s.color, l.buffer.duration, offsets[s.id], viewSpan);
    }
  }, [loaded, offsets, viewSpan]);

  const setOffset = useCallback((id: string, sec: number) => {
    setOffsets((prev) => ({ ...prev, [id]: sec }));
    engineRef.current?.setOffset(id, sec);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pxPerSec = rect.width / viewSpan;
    dragRef.current = {
      id,
      startClientX: e.clientX,
      startOffsetSec: offsets[id],
      pxPerSec,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusedId(id);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const deltaSec = dx / drag.pxPerSec;
    setOffset(drag.id, drag.startOffsetSec + deltaSec);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  // Keyboard nudge — listen on document, act only when a row is focused
  useEffect(() => {
    if (!focusedId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Don't hijack if user is typing in an input
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const mag = e.altKey ? ALT_NUDGE_MS : e.shiftKey ? SHIFT_NUDGE_MS : NUDGE_MS;
      setOffset(focusedId, offsets[focusedId] + (dir * mag) / 1000);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedId, offsets, setOffset]);

  const togglePlay = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    if (playing) {
      e.pause();
      setPlaying(false);
    } else {
      e.seek(0);
      await e.play();
      setPlaying(true);
    }
  }, [playing]);

  if (error) {
    return (
      <div style={{ padding: '1rem', background: '#2a1414', color: '#fca5a5', borderRadius: 8 }}>
        Failed to load samples: {error}
      </div>
    );
  }

  return (
    <div style={{ background: '#111827', color: '#e5e7eb', padding: '1rem', borderRadius: 8, fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={togglePlay}
          disabled={loading}
          style={{
            padding: '0.3rem 0.7rem',
            background: playing ? '#dc2626' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {loading ? 'Loading…' : playing ? 'Stop' : 'Play from 0'}
        </button>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>
          drag rows · click to focus · arrow ±{NUDGE_MS}ms · shift ±{SHIFT_NUDGE_MS}ms · alt ±{ALT_NUDGE_MS}ms
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SAMPLES.map((s) => {
          const focused = focusedId === s.id;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 60, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: s.color,
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontWeight: 500 }}>{s.label}</span>
              </div>
              <div
                tabIndex={0}
                onPointerDown={(e) => onPointerDown(e, s.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onFocus={() => setFocusedId(s.id)}
                onClick={() => setFocusedId(s.id)}
                style={{
                  flex: 1,
                  position: 'relative',
                  height: ROW_HEIGHT,
                  background: '#020617',
                  borderRadius: 4,
                  overflow: 'hidden',
                  cursor: dragRef.current?.id === s.id ? 'grabbing' : 'grab',
                  outline: focused ? '2px solid #3b82f6' : '2px solid transparent',
                  outlineOffset: -2,
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                <canvas
                  ref={(el) => {
                    canvasRefs.current[s.id] = el;
                  }}
                  style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
                />
                {/* t=0 guide line */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    width: 1,
                    background: 'rgba(255,255,255,0.25)',
                    pointerEvents: 'none',
                  }}
                  title="t=0"
                />
              </div>
              <div
                style={{
                  width: 72,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 12,
                  color: focused ? '#e5e7eb' : '#9ca3af',
                  fontWeight: focused ? 500 : 400,
                }}
              >
                {fmtMs(offsets[s.id])}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
