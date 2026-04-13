import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePeaks } from '../utils/stemPeaks';
import { AlignmentPlayback } from '../utils/alignmentPlayback';

/**
 * Pure alignment UI: stacked waveforms, drag-to-offset, click-to-seek,
 * keyboard nudge, mute/solo, cmd+scroll zoom, shift+scroll pan,
 * directly editable ms input. State is owned locally; the parent feeds
 * stems + receives offset changes via callback.
 *
 * Used by both the new-song wizard's AlignmentStep and the standalone
 * re-align page (AlignSongPage).
 */

export interface AlignmentCanvasStem {
  id: string;
  label: string;
  color: string;
  buffer: AudioBuffer;
  offsetSec: number;
}

interface Props {
  stems: AlignmentCanvasStem[];
  onOffsetChange: (id: string, offsetSec: number) => void;
}

const BUCKET_COUNT = 2048;
const ROW_HEIGHT = 72;
const MIN_ZOOM_SPAN = 0.05;
const ZOOM_STEP = 1.15;
const NUDGE_MS = 1;
const SHIFT_NUDGE_MS = 10;
const ALT_NUDGE_MS = 100;
const DRAG_THRESHOLD_PX = 3;

function fmtTime(s: number): string {
  const sign = s < 0 ? '-' : '';
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = (abs % 60).toFixed(2).padStart(5, '0');
  return `${sign}${m}:${sec}`;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 rounded border border-gray-700 bg-gray-900 text-gray-200 font-mono text-[10px] leading-none">
      {children}
    </kbd>
  );
}

function MsInput({ valueSec, onCommit }: { valueSec: number; onCommit: (sec: number) => void }) {
  const currentMs = Math.round(valueSec * 1000);
  const [draft, setDraft] = useState<string>(String(currentMs));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(currentMs));
  }, [currentMs, focused]);

  const commit = () => {
    const ms = parseFloat(draft);
    if (Number.isFinite(ms)) {
      onCommit(ms / 1000);
      setDraft(String(Math.round(ms)));
    } else {
      setDraft(String(currentMs));
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(String(currentMs));
          e.currentTarget.blur();
        }
      }}
      className="w-20 px-2 py-0.5 bg-gray-900 border border-gray-700 rounded text-xs text-right font-mono tabular-nums focus:outline-none focus:border-blue-500"
    />
  );
}

function drawRow(
  canvas: HTMLCanvasElement,
  peaks: Float32Array,
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

  ctx.fillStyle = '#ffffff';
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

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(cssWidth, centerY);
  ctx.stroke();
}

export function AlignmentCanvas({ stems, onOffsetChange }: Props) {
  const [peaks, setPeaks] = useState<Record<string, Float32Array>>({});
  const [mixState, setMixState] = useState<Record<string, { muted: boolean; soloed: boolean }>>(
    () => Object.fromEntries(stems.map((s) => [s.id, { muted: false, soloed: false }])),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);

  const engineRef = useRef<AlignmentPlayback | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const rowsContainerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const userZoomedRef = useRef(false);
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startOffsetSec: number;
    pxPerSec: number;
    didDrag: boolean;
  } | null>(null);

  // Fixed scale span: longest buffer duration. Drag doesn't rescale —
  // content walks off-screen instead.
  const spanSec = useMemo(() => {
    let max = 0;
    for (const s of stems) max = Math.max(max, s.buffer.duration);
    return Math.max(max, 1);
  }, [stems]);

  // Compute peaks + init engine on mount / when stem set changes
  useEffect(() => {
    if (stems.length === 0) return;

    const p: Record<string, Float32Array> = {};
    for (const s of stems) {
      p[s.id] = computePeaks(s.buffer, BUCKET_COUNT);
    }
    setPeaks(p);

    const engine = new AlignmentPlayback();
    engine.load(
      stems.map((s) => ({
        id: s.id,
        buffer: s.buffer,
        offsetSec: s.offsetSec,
      })),
    );
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // Re-init only when stem set identity changes (rare — load page mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems.map((s) => s.id).join(',')]);

  // Keep engine offsets in sync with parent state
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    for (const s of stems) e.setOffset(s.id, s.offsetSec);
  }, [stems]);

  // Seed view range
  useEffect(() => {
    if (!userZoomedRef.current) {
      setViewStart(0);
      setViewEnd(spanSec);
    } else {
      setViewEnd((prev) => Math.min(prev, spanSec));
      setViewStart((prev) => Math.max(0, Math.min(prev, spanSec - MIN_ZOOM_SPAN)));
    }
  }, [spanSec]);

  // Redraw
  useEffect(() => {
    for (const s of stems) {
      const canvas = canvasRefs.current[s.id];
      const peakData = peaks[s.id];
      if (!canvas || !peakData) continue;
      drawRow(canvas, peakData, s.buffer.duration, s.offsetSec, viewStart, viewEnd);
    }
  }, [stems, peaks, viewStart, viewEnd]);

  // Playhead loop
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const e = engineRef.current;
      if (e) {
        const p = e.getPosition();
        if (p >= e.duration) {
          e.pause();
          e.seek(0);
          setPlaying(false);
          setPosition(0);
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

  // Wheel: cmd/ctrl + scroll → zoom; shift + scroll → pan
  const viewEndRef = useRef(viewEnd);
  const spanSecRef = useRef(spanSec);
  useEffect(() => {
    viewEndRef.current = viewEnd;
  }, [viewEnd]);
  useEffect(() => {
    spanSecRef.current = spanSec;
  }, [spanSec]);

  useEffect(() => {
    const container = rowsContainerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      const isZoom = e.ctrlKey || e.metaKey;
      const isPan = e.shiftKey && !isZoom;
      if (!isZoom && !isPan) return;
      e.preventDefault();
      const firstCanvas = Object.values(canvasRefs.current).find(Boolean);
      if (!firstCanvas) return;
      const rect = firstCanvas.getBoundingClientRect();

      if (isPan) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setViewStart((vs) => {
          const ve = viewEndRef.current;
          const span = ve - vs;
          const pxPerSec = rect.width / span;
          const deltaSec = delta / pxPerSec;
          let newStart = vs + deltaSec;
          let newEnd = newStart + span;
          if (newStart < 0) {
            newStart = 0;
            newEnd = span;
          }
          if (newEnd > spanSecRef.current) {
            newEnd = spanSecRef.current;
            newStart = Math.max(0, newEnd - span);
          }
          setViewEnd(newEnd);
          return newStart;
        });
        return;
      }

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

  // Keyboard nudge (arrows, when a track is focused)
  useEffect(() => {
    if (!focusedId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const stem = stems.find((s) => s.id === focusedId);
      if (!stem) return;
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const mag = e.altKey ? ALT_NUDGE_MS : e.shiftKey ? SHIFT_NUDGE_MS : NUDGE_MS;
      onOffsetChange(focusedId, stem.offsetSec + (dir * mag) / 1000);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedId, stems, onOffsetChange]);

  // Space bar toggles play/pause globally (no need to focus the button).
  // Defined after togglePlay below via ref so we don't thrash the listener
  // every re-render.
  const togglePlayRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      togglePlayRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const viewSpan = viewEnd - viewStart;
    const pxPerSec = rect.width / viewSpan;
    const stem = stems.find((s) => s.id === id);
    if (!stem) return;
    dragRef.current = {
      id,
      startClientX: e.clientX,
      startOffsetSec: stem.offsetSec,
      pxPerSec,
      didDrag: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusedId(id);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    if (!drag.didDrag && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    drag.didDrag = true;
    const deltaSec = dx / drag.pxPerSec;
    onOffsetChange(drag.id, drag.startOffsetSec + deltaSec);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag.didDrag) {
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const viewSpan = viewEnd - viewStart;
      const sec = Math.max(0, Math.min(spanSec, viewStart + frac * viewSpan));
      engineRef.current?.seek(sec);
      setPosition(sec);
    }
    dragRef.current = null;
  };

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

  // Keep the global-space-bar listener pointed at the latest togglePlay
  useEffect(() => {
    togglePlayRef.current = () => {
      void togglePlay();
    };
  }, [togglePlay]);

  const toggleMute = useCallback((id: string) => {
    setMixState((prev) => {
      const cur = prev[id] ?? { muted: false, soloed: false };
      const next = { ...cur, muted: !cur.muted };
      engineRef.current?.setMuted(id, next.muted);
      return { ...prev, [id]: next };
    });
  }, []);

  const toggleSolo = useCallback((id: string) => {
    setMixState((prev) => {
      const cur = prev[id] ?? { muted: false, soloed: false };
      const next = { ...cur, soloed: !cur.soloed };
      engineRef.current?.setSoloed(id, next.soloed);
      return { ...prev, [id]: next };
    });
  }, []);

  const resetZoom = () => {
    userZoomedRef.current = false;
    setViewStart(0);
    setViewEnd(spanSec);
  };

  const onTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const sec = Math.max(0, Math.min(spanSec, frac * spanSec));
    engineRef.current?.seek(sec);
    setPosition(sec);
  };

  /** Stop playback. Useful for parents to call before unmounting / navigating. */
  const stopPlayback = useCallback(() => {
    engineRef.current?.pause();
    setPlaying(false);
  }, []);

  const viewSpan = viewEnd - viewStart;
  const playheadInViewFrac = viewSpan > 0 ? (position - viewStart) / viewSpan : 0;
  const playheadVisible = playheadInViewFrac >= 0 && playheadInViewFrac <= 1;

  // Expose stopPlayback via ref-like pattern — parent can call it as a side-effect on its own button handlers
  // by passing this component a ref. For now it's internal; if parents need it, lift via forwardRef.
  void stopPlayback;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-gray-400">
        <dt className="text-gray-500">View</dt>
        <dd>
          <Kbd>cmd</Kbd>/<Kbd>ctrl</Kbd> + scroll to zoom
          {' · '}<Kbd>shift</Kbd> + scroll to pan
        </dd>

        <dt className="text-gray-500">Align</dt>
        <dd>drag a track horizontally to offset it in time</dd>

        <dt className="text-gray-500">Nudge</dt>
        <dd>
          click a track, then <Kbd>←</Kbd> <Kbd>→</Kbd> for ±1 ms
          {' · '}<Kbd>shift</Kbd> for ±10 ms
          {' · '}<Kbd>alt</Kbd> for ±100 ms
        </dd>

        <dt className="text-gray-500">Set exact</dt>
        <dd>type a millisecond value in the field on the right of each track</dd>

        <dt className="text-gray-500">Audition</dt>
        <dd>
          <Kbd>space</Kbd> play/pause · <Kbd>M</Kbd> mutes, <Kbd>S</Kbd> solos · click any waveform or the timeline to seek
        </dd>
      </dl>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={togglePlay}
          className={`px-3 py-1.5 rounded text-sm font-medium ${
            playing ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="font-mono text-sm text-gray-300 tabular-nums">
          {fmtTime(position)} / {fmtTime(spanSec)}
        </span>
        <span className="text-xs text-gray-500 font-mono">
          view {fmtTime(viewStart)}–{fmtTime(viewEnd)} ({viewSpan.toFixed(2)}s)
        </span>
        <button
          onClick={resetZoom}
          disabled={!userZoomedRef.current}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default rounded"
        >
          Reset zoom
        </button>
      </div>

      <div
        onClick={onTimelineClick}
        className="relative h-2 bg-gray-800 rounded cursor-pointer"
      >
        <div
          className="absolute inset-y-0 bg-blue-500/25 pointer-events-none"
          style={{
            left: `${(viewStart / spanSec) * 100}%`,
            width: `${(viewSpan / spanSec) * 100}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-blue-500"
          style={{ left: `${(position / spanSec) * 100}%` }}
        />
      </div>

      <div ref={rowsContainerRef} className="space-y-2">
        {stems.map((stem) => {
          const focused = focusedId === stem.id;
          const mix = mixState[stem.id] ?? { muted: false, soloed: false };
          const color = stem.color || '#6b7280';
          const loaded = !!peaks[stem.id];
          return (
            <div key={stem.id} className="bg-gray-800 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm font-medium min-w-24 truncate">{stem.label}</span>
                <button
                  onClick={() => toggleMute(stem.id)}
                  className={`px-2 py-0.5 text-xs rounded font-mono ${
                    mix.muted ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title="Mute"
                >
                  M
                </button>
                <button
                  onClick={() => toggleSolo(stem.id)}
                  className={`px-2 py-0.5 text-xs rounded font-mono ${
                    mix.soloed ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  title="Solo"
                >
                  S
                </button>

                <div className="ml-auto flex items-center gap-1.5">
                  <MsInput
                    valueSec={stem.offsetSec}
                    onCommit={(sec) => onOffsetChange(stem.id, sec)}
                  />
                  <span className="text-xs text-gray-500">ms</span>
                </div>
              </div>
              <div
                tabIndex={0}
                onPointerDown={(e) => onPointerDown(e, stem.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onFocus={() => setFocusedId(stem.id)}
                className="relative bg-black rounded overflow-hidden"
                style={{
                  height: ROW_HEIGHT,
                  outline: focused ? '2px solid #3b82f6' : '2px solid transparent',
                  outlineOffset: -2,
                  touchAction: 'none',
                  userSelect: 'none',
                  cursor: dragRef.current?.id === stem.id && dragRef.current.didDrag ? 'grabbing' : 'grab',
                }}
              >
                {!loaded && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
                    Decoding…
                  </div>
                )}
                <canvas
                  ref={(el) => {
                    canvasRefs.current[stem.id] = el;
                  }}
                  className="block w-full h-full"
                  style={{ pointerEvents: 'none' }}
                />
                {viewStart <= 0 && (
                  <div
                    className="absolute inset-y-0 w-px bg-white/30 pointer-events-none"
                    style={{ left: `${((0 - viewStart) / viewSpan) * 100}%` }}
                  />
                )}
                {playheadVisible && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-blue-500 pointer-events-none"
                    style={{ left: `${playheadInViewFrac * 100}%` }}
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
