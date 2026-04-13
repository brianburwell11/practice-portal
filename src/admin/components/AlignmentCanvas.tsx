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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);
  const [markers, setMarkers] = useState<number[]>([]);
  const [markerSelectedIndex, setMarkerSelectedIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<Array<{ offsets: Record<string, number>; markers: number[] }>>([]);

  const engineRef = useRef<AlignmentPlayback | null>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const rowsContainerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const userZoomedRef = useRef(false);
  /** Last clicked stem id — used as the anchor for shift+click range select */
  const anchorIdRef = useRef<string | null>(null);
  const dragRef = useRef<{
    anchorId: string;
    startClientX: number;
    /** Starting offsetSec for every stem that moves together */
    startOffsets: Map<string, number>;
    pxPerSec: number;
    didDrag: boolean;
    /** The waveform element the pointer came down on — used for seek on pure click */
    waveformEl: HTMLElement;
  } | null>(null);
  const markerDragRef = useRef<{
    index: number;
    startClientX: number;
    startSec: number;
    pxPerSec: number;
    waveformEl: HTMLElement;
    didMove: boolean;
  } | null>(null);

  // Refs mirroring the latest props/state — used by keydown listeners and
  // history helpers that subscribe once, so they always read current values
  // without re-subscribing on every render.
  const stemsRef = useRef(stems);
  const markersRef = useRef(markers);
  const historyRef = useRef(history);
  const markerSelectedRef = useRef(markerSelectedIndex);
  const onOffsetChangeRef = useRef(onOffsetChange);
  useEffect(() => { stemsRef.current = stems; }, [stems]);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { markerSelectedRef.current = markerSelectedIndex; }, [markerSelectedIndex]);
  useEffect(() => { onOffsetChangeRef.current = onOffsetChange; }, [onOffsetChange]);

  /** Snapshot the current (offsets, markers) onto the history stack so undo
   *  can restore them. Call BEFORE applying a mutation. */
  const pushHistory = () => {
    setHistory((h) => [
      ...h,
      {
        offsets: Object.fromEntries(stemsRef.current.map((s) => [s.id, s.offsetSec])),
        markers: [...markersRef.current],
      },
    ]);
  };

  const undo = () => {
    const h = historyRef.current;
    if (h.length === 0) return;
    const prev = h[h.length - 1];
    for (const [id, sec] of Object.entries(prev.offsets)) onOffsetChangeRef.current(id, sec);
    setMarkers(prev.markers);
    setHistory(h.slice(0, -1));
    setMarkerSelectedIndex(null);
  };

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

  // Keyboard nudge (arrows) — applies to every selected track
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const mag = e.altKey ? ALT_NUDGE_MS : e.shiftKey ? SHIFT_NUDGE_MS : NUDGE_MS;
      const deltaSec = (dir * mag) / 1000;
      pushHistory();
      for (const id of selectedIds) {
        const stem = stems.find((s) => s.id === id);
        if (!stem) continue;
        onOffsetChange(id, stem.offsetSec + deltaSec);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, stems, onOffsetChange]);

  // Click outside any stem card clears the selection (tracks + any selected
  // marker). Interactive controls (buttons, inputs) don't trigger a clear —
  // only genuinely empty areas do.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-stem-card]')) return;
      if (target.closest('button, input, textarea, select, a')) return;
      setSelectedIds(new Set());
      setMarkerSelectedIndex(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  // Cmd/Ctrl + A selects every track
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'a' && e.key !== 'A') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setSelectedIds(new Set(stems.map((s) => s.id)));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stems]);

  // Marker + undo shortcuts: M, Delete/Backspace (on selected marker), Cmd/Ctrl+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      // Cmd/Ctrl + Z — undo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // M — add marker at current playhead
      if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const playheadSec = engineRef.current?.getPosition() ?? 0;
        pushHistory();
        setMarkers((m) => [...m, playheadSec]);
        return;
      }

      // Delete / Backspace — remove the selected marker
      if ((e.key === 'Delete' || e.key === 'Backspace') && markerSelectedRef.current !== null) {
        e.preventDefault();
        const idx = markerSelectedRef.current;
        pushHistory();
        setMarkers((m) => m.filter((_, i) => i !== idx));
        setMarkerSelectedIndex(null);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    const stem = stems.find((s) => s.id === id);
    if (!stem) return;

    // Interactive controls inside the card (M/S buttons, ms input) handle
    // their own events; don't hijack them for selection/drag.
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest('button, input, textarea, select')) return;

    // Clicking anywhere on a card deselects any selected marker. (Marker
    // clicks stopPropagation so this handler only runs for non-marker clicks.)
    setMarkerSelectedIndex(null);

    // Shift+click: range select from the anchor to this stem (inclusive),
    // replacing the current selection. Anchor is NOT updated.
    if (e.shiftKey) {
      const anchor = anchorIdRef.current;
      if (anchor && anchor !== id) {
        const anchorIdx = stems.findIndex((s) => s.id === anchor);
        const thisIdx = stems.findIndex((s) => s.id === id);
        if (anchorIdx >= 0 && thisIdx >= 0) {
          const [a, b] = anchorIdx < thisIdx ? [anchorIdx, thisIdx] : [thisIdx, anchorIdx];
          setSelectedIds(new Set(stems.slice(a, b + 1).map((s) => s.id)));
        } else {
          setSelectedIds(new Set([id]));
        }
      } else {
        // No anchor yet — treat like a plain select of this row
        setSelectedIds(new Set([id]));
        anchorIdRef.current = id;
      }
      return;
    }

    // Cmd/Ctrl + click: toggle this stem in the selection. Anchor updates.
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorIdRef.current = id;
      return;
    }

    // Plain click: behavior depends on where on the card the click landed.
    //  - Header area (not the waveform) → selection-only. Select just this
    //    stem and update the anchor. No drag, no seek.
    //  - Waveform area → seek-or-drag. Selection is untouched. A pure click
    //    seeks; dragging moves the stem(s): all selected if this is in the
    //    selection, otherwise just this one.
    const waveformEl = targetEl.closest('[data-track-waveform]') as HTMLElement | null;

    if (!waveformEl) {
      setSelectedIds((prev) => (prev.has(id) ? prev : new Set([id])));
      anchorIdRef.current = id;
      return;
    }

    const rect = waveformEl.getBoundingClientRect();
    const viewSpan = viewEnd - viewStart;
    const pxPerSec = rect.width / viewSpan;

    const movingIds = selectedIds.has(id) ? selectedIds : new Set([id]);
    const startOffsets = new Map<string, number>();
    for (const sid of movingIds) {
      const s = stems.find((x) => x.id === sid);
      if (s) startOffsets.set(sid, s.offsetSec);
    }

    dragRef.current = {
      anchorId: id,
      startClientX: e.clientX,
      startOffsets,
      pxPerSec,
      didDrag: false,
      waveformEl,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    if (!drag.didDrag && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    // First real movement — snapshot pre-drag state for undo
    if (!drag.didDrag) pushHistory();
    drag.didDrag = true;
    const deltaSec = dx / drag.pxPerSec;
    for (const [id, startOffset] of drag.startOffsets) {
      onOffsetChange(id, startOffset + deltaSec);
    }
  };

  const onMarkerPointerDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't let the card's pointerdown fire
    const waveformEl = (e.target as HTMLElement).closest(
      '[data-track-waveform]',
    ) as HTMLElement | null;
    if (!waveformEl) return;
    const rect = waveformEl.getBoundingClientRect();
    const viewSpan = viewEnd - viewStart;
    markerDragRef.current = {
      index,
      startClientX: e.clientX,
      startSec: markers[index],
      pxPerSec: rect.width / viewSpan,
      waveformEl,
      didMove: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMarkerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = markerDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    if (!drag.didMove && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!drag.didMove) {
      pushHistory();
      drag.didMove = true;
    }
    const deltaSec = dx / drag.pxPerSec;
    const newSec = Math.max(0, Math.min(spanSec, drag.startSec + deltaSec));
    setMarkers((m) => m.map((s, i) => (i === drag.index ? newSec : s)));
  };

  const onMarkerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = markerDragRef.current;
    if (!drag) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!drag.didMove) {
      // Pure click → select this marker
      setMarkerSelectedIndex(drag.index);
    }
    markerDragRef.current = null;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!drag.didDrag) {
      // Plain click without drag on a waveform → seek. Use the waveform
      // element captured at pointerdown; after setPointerCapture on the
      // outer card, e.target here is the card, so closest() wouldn't find
      // the waveform on the way up.
      const rect = drag.waveformEl.getBoundingClientRect();
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

        <dt className="text-gray-500">Select</dt>
        <dd>
          click a track's label area · <Kbd>shift</Kbd>+click for a range · <Kbd>cmd</Kbd>/<Kbd>ctrl</Kbd>+click to toggle · <Kbd>cmd</Kbd>/<Kbd>ctrl</Kbd>+<Kbd>A</Kbd> for all · click outside to clear
        </dd>

        <dt className="text-gray-500">Mark</dt>
        <dd>
          <Kbd>M</Kbd> add marker at playhead · click a marker to select · drag to move · <Kbd>Delete</Kbd> removes
        </dd>

        <dt className="text-gray-500">Align</dt>
        <dd>drag a waveform to offset · selected tracks move together · dragging an unselected track moves just that one · <Kbd>cmd</Kbd>/<Kbd>ctrl</Kbd>+<Kbd>Z</Kbd> to undo</dd>

        <dt className="text-gray-500">Nudge</dt>
        <dd>
          <Kbd>←</Kbd> <Kbd>→</Kbd> for ±1 ms
          {' · '}<Kbd>shift</Kbd> for ±10 ms
          {' · '}<Kbd>alt</Kbd> for ±100 ms (applies to all selected)
        </dd>

        <dt className="text-gray-500">Set exact</dt>
        <dd>type a millisecond value in the field on the right — sets every selected track to that value</dd>

        <dt className="text-gray-500">Audition</dt>
        <dd>
          <Kbd>space</Kbd> play/pause · click a waveform or the timeline to seek · M/S buttons on each card mute/solo
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
        {markers.map((sec, mi) => (
          <div
            key={`scrub-marker-${mi}`}
            className="absolute inset-y-0 w-0.5 bg-yellow-500/80 pointer-events-none"
            style={{ left: `${(sec / spanSec) * 100}%` }}
          />
        ))}
        <div
          className="absolute inset-y-0 w-0.5 bg-blue-500"
          style={{ left: `${(position / spanSec) * 100}%` }}
        />
      </div>

      <div ref={rowsContainerRef} className="space-y-2">
        {stems.map((stem) => {
          const selected = selectedIds.has(stem.id);
          const mix = mixState[stem.id] ?? { muted: false, soloed: false };
          const color = stem.color || '#6b7280';
          const loaded = !!peaks[stem.id];
          return (
            <div
              key={stem.id}
              data-stem-card
              onPointerDown={(e) => onPointerDown(e, stem.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="bg-gray-800 rounded-lg p-2 space-y-1.5"
              style={{
                outline: selected ? '2px solid #3b82f6' : '2px solid transparent',
                outlineOffset: -1,
                cursor: dragRef.current?.startOffsets.has(stem.id) && dragRef.current.didDrag ? 'grabbing' : 'default',
                userSelect: 'none',
              }}
            >
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
                    onCommit={(sec) => {
                      pushHistory();
                      // If multiple tracks are selected and this one is among
                      // them, set them all to the same value. Otherwise just
                      // this one.
                      if (selectedIds.size > 1 && selectedIds.has(stem.id)) {
                        for (const id of selectedIds) onOffsetChange(id, sec);
                      } else {
                        onOffsetChange(stem.id, sec);
                      }
                    }}
                  />
                  <span className="text-xs text-gray-500">ms</span>
                </div>
              </div>
              <div
                data-track-waveform
                className="relative bg-black rounded overflow-hidden"
                style={{
                  height: ROW_HEIGHT,
                  touchAction: 'none',
                  cursor: dragRef.current?.startOffsets.has(stem.id) && dragRef.current.didDrag ? 'grabbing' : 'grab',
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
                {markers.map((sec, mi) => {
                  const frac = (sec - viewStart) / viewSpan;
                  if (frac < 0 || frac > 1) return null;
                  const mSelected = markerSelectedIndex === mi;
                  return (
                    <div
                      key={`marker-${mi}`}
                      onPointerDown={(e) => onMarkerPointerDown(e, mi)}
                      onPointerMove={onMarkerPointerMove}
                      onPointerUp={onMarkerPointerUp}
                      onPointerCancel={onMarkerPointerUp}
                      className="absolute inset-y-0 flex justify-center"
                      style={{
                        left: `${frac * 100}%`,
                        width: 10,
                        transform: 'translateX(-50%)',
                        cursor: 'col-resize',
                        touchAction: 'none',
                      }}
                    >
                      <div
                        className={mSelected ? 'w-1 h-full bg-yellow-300' : 'w-0.5 h-full bg-yellow-500/80'}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
