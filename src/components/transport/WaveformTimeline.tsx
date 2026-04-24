import { useRef, useEffect, useCallback, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import type { TapMapEntry } from '../../audio/types';
import { markersToSeconds } from '../../audio/tempoUtils';
import { autoLabelSection } from '../../audio/tapMapUtils';

/** Detect coarse pointer (touch device) */
const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Snap threshold in pixels — how close the cursor must be to a marker to snap. */
const SNAP_PX = isCoarse ? 24 : 12;
/** Loop marker hit test threshold in pixels */
const HIT_PX = isCoarse ? 20 : 6;
/** Minimum zoom level in seconds */
const MIN_VIEW = 5;
/** Default zoom level in seconds for mobile */
const DEFAULT_MOBILE_VIEW = 30;
/** Default zoom level in seconds for desktop (songs > 2.5 min start zoomed) */
const DEFAULT_DESKTOP_VIEW = 150;

export function WaveformTimeline() {
  const engine = useAudioEngine();
  const { position, duration, loopA, loopB, loopEnabled, followPlayhead, setFollowPlayhead } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const lyricsEditorOpen = useLyricsEditorStore((s) => s.isOpen);
  const lyricsLines = useLyricsEditorStore((s) => s.lines);
  const moveLyricLine = useLyricsEditorStore((s) => s.moveLine);

  // TapMap editor integration \u2014 when the editor is open the timeline
  // sources its tapMap from the editor store (live, dirty copy) and
  // supports select-and-drag on entries. Outside the editor it reads
  // the song's saved tapMap as before.
  const markerEditorOpen = useMarkerEditorStore((s) => s.isOpen);
  const editorTapMap = useMarkerEditorStore((s) => s.tapMap);
  const markerSelectedIndex = useMarkerEditorStore((s) => s.selectedIndex);
  const setMarkerSelectedIndex = useMarkerEditorStore((s) => s.setSelectedIndex);
  const moveMarkerEntry = useMarkerEditorStore((s) => s.moveEntry);
  const updateMarkerEntryType = useMarkerEditorStore((s) => s.updateEntryType);
  const displayTapMap: TapMapEntry[] | undefined = markerEditorOpen
    ? editorTapMap
    : selectedSong?.tapMap;

  // Main canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [canvasReady, setCanvasReady] = useState(false);

  // Overview canvas refs
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overviewContainerRef = useRef<HTMLDivElement>(null);
  const overviewSizeRef = useRef({ width: 0, height: 0 });

  // Viewport state — mobile starts zoomed to ~10s, desktop fully zoomed out
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(isCoarse ? DEFAULT_MOBILE_VIEW : DEFAULT_DESKTOP_VIEW);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [draggingMarker, setDraggingMarker] = useState<'A' | 'B' | null>(null);
  const suppressClickRef = useRef(false);

  // Pinch-to-zoom state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; viewDuration: number; centerX: number } | null>(null);

  // Single-finger drag-to-pan state
  const dragStartRef = useRef<{ x: number; viewStart: number } | null>(null);
  const didDragRef = useRef(false);
  const DRAG_THRESHOLD = 8;

  const effectiveViewDuration = Math.min(viewDuration, duration || Infinity);
  const isZoomed = duration > 0 && effectiveViewDuration < duration;

  // Clamp viewStart helper
  const clampViewStart = useCallback(
    (vs: number, vd: number) => {
      if (!duration) return 0;
      return Math.max(0, Math.min(duration - vd, vs));
    },
    [duration],
  );

  // Reset zoom when song changes
  useEffect(() => {
    setViewStart(0);
    setViewDuration(isCoarse ? DEFAULT_MOBILE_VIEW : DEFAULT_DESKTOP_VIEW);
  }, [selectedSong?.id]);

  // Viewport coordinate helpers
  const secondsToPixel = useCallback(
    (seconds: number, width: number) => ((seconds - viewStart) / effectiveViewDuration) * width,
    [viewStart, effectiveViewDuration],
  );

  const pixelToSeconds = useCallback(
    (px: number, width: number) => viewStart + (px / width) * effectiveViewDuration,
    [viewStart, effectiveViewDuration],
  );

  // Find nearest snappable marker (section or measure) near a pixel X
  const findSnapMarker = useCallback(
    (pixelX: number): number | null => {
      if (!duration || !selectedSong) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;

      const tapMap = displayTapMap;
      if (tapMap && tapMap.length > 0) {
        let closest: { time: number; dist: number } | null = null;
        for (const entry of tapMap as TapMapEntry[]) {
          if (entry.type === 'beat') continue;
          const markerX = secondsToPixel(entry.time, width);
          const dist = Math.abs(pixelX - markerX);
          if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
            closest = { time: entry.time, dist };
          }
        }
        return closest?.time ?? null;
      }

      const markers = markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset);
      let closest: { time: number; dist: number } | null = null;
      for (const marker of markers) {
        const markerX = secondsToPixel(marker.seconds, width);
        const dist = Math.abs(pixelX - markerX);
        if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
          closest = { time: marker.seconds, dist };
        }
      }
      return closest?.time ?? null;
    },
    [duration, selectedSong, displayTapMap, secondsToPixel],
  );

  // Hit test: check if a pixel X is within threshold of loop A or B marker
  const hitTestLoopMarker = useCallback(
    (pixelX: number): 'A' | 'B' | null => {
      if (loopA === null || loopB === null) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      const ax = secondsToPixel(loopA, width);
      const bx = secondsToPixel(loopB, width);
      const distA = Math.abs(pixelX - ax);
      const distB = Math.abs(pixelX - bx);
      if (distA <= HIT_PX && distB <= HIT_PX) return distA <= distB ? 'A' : 'B';
      if (distA <= HIT_PX) return 'A';
      if (distB <= HIT_PX) return 'B';
      return null;
    },
    [loopA, loopB, secondsToPixel],
  );

  // Lyric marker drag state
  const dragLyricRef = useRef<{ index: number; time: number } | null>(null);
  // TapMap editor entry drag state \u2014 mirrors the lyric-marker pattern.
  const dragEditorEntryRef = useRef<{ index: number; time: number } | null>(null);

  // Hit-test tapMap entries when the editor is active. Threshold
  // matches HIT_PX (same as loop/lyric markers) so behavior is
  // consistent across editable elements on the timeline.
  const hitTestEditorEntry = useCallback(
    (pixelX: number): number | null => {
      if (!markerEditorOpen || editorTapMap.length === 0) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      let closest: { index: number; dist: number } | null = null;
      for (let i = 0; i < editorTapMap.length; i++) {
        const t = dragEditorEntryRef.current?.index === i
          ? dragEditorEntryRef.current.time
          : editorTapMap[i].time;
        const mx = secondsToPixel(t, width);
        const dist = Math.abs(pixelX - mx);
        if (dist <= HIT_PX && (!closest || dist < closest.dist)) {
          closest = { index: i, dist };
        }
      }
      return closest?.index ?? null;
    },
    [markerEditorOpen, editorTapMap, secondsToPixel],
  );

  const hitTestLyricMarker = useCallback(
    (pixelX: number): number | null => {
      if (!lyricsEditorOpen || !lyricsLines.length) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      let closest: { index: number; dist: number } | null = null;
      for (let i = 0; i < lyricsLines.length; i++) {
        const t = lyricsLines[i].time;
        if (t === null) continue;
        const mx = secondsToPixel(t, width);
        const dist = Math.abs(pixelX - mx);
        if (dist <= HIT_PX && (!closest || dist < closest.dist)) {
          closest = { index: i, dist };
        }
      }
      return closest?.index ?? null;
    },
    [lyricsEditorOpen, lyricsLines, secondsToPixel],
  );

  const [cursorStyle, setCursorStyle] = useState<string>('pointer');

  // Right-click context menu for changing a tapMap entry's type. Only
  // active while the marker editor is open. Position is in container-
  // relative pixels so the popup stays pinned to the waveform.
  const [markerContextMenu, setMarkerContextMenu] = useState<{
    entryIndex: number;
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!markerEditorOpen) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hit = hitTestEditorEntry(x);
      if (hit === null) return;
      e.preventDefault();
      setMarkerSelectedIndex(hit);
      setMarkerContextMenu({
        entryIndex: hit,
        x,
        y: e.clientY - rect.top,
      });
    },
    [markerEditorOpen, hitTestEditorEntry, setMarkerSelectedIndex],
  );

  // Close the menu automatically if the editor closes or the entry
  // vanishes (e.g. deleted, undo), and on outside click / Escape.
  useEffect(() => {
    if (!markerContextMenu) return;
    if (!markerEditorOpen || markerContextMenu.entryIndex >= editorTapMap.length) {
      setMarkerContextMenu(null);
      return;
    }
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.closest('[data-marker-context-menu]')) return;
      setMarkerContextMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMarkerContextMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [markerContextMenu, markerEditorOpen, editorTapMap.length]);

  const contextMenuEntry =
    markerContextMenu !== null ? editorTapMap[markerContextMenu.entryIndex] : undefined;

  const handleChangeMarkerType = useCallback(
    (newType: TapMapEntry['type']) => {
      if (!markerContextMenu || !contextMenuEntry) return;
      const label =
        newType === 'section' && !contextMenuEntry.label
          ? autoLabelSection(editorTapMap)
          : undefined;
      updateMarkerEntryType(markerContextMenu.entryIndex, newType, label);
      setMarkerContextMenu(null);
    },
    [markerContextMenu, contextMenuEntry, editorTapMap, updateMarkerEntryType],
  );

  // --- Pointer event handlers (unified mouse + touch) ---

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Track pointer for pinch
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      // Start pinch if two fingers
      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.abs(pts[0].x - pts[1].x);
        const centerClientX = (pts[0].x + pts[1].x) / 2;
        const centerX = centerClientX - rect.left;
        pinchStartRef.current = { dist, viewDuration: effectiveViewDuration, centerX };
        dragStartRef.current = null;
        setDraggingMarker(null);
        return;
      }

      // Single pointer: check editor-entry hit first when the
      // tapMap editor is open. Entry hits supersede the generic
      // click-to-seek so markers can be selected/dragged without
      // the playhead jumping.
      const editorHit = hitTestEditorEntry(x);
      if (editorHit !== null) {
        e.preventDefault();
        setMarkerSelectedIndex(editorHit);
        dragEditorEntryRef.current = { index: editorHit, time: editorTapMap[editorHit].time };
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Single pointer: check lyric marker hit next
      const lyricHit = hitTestLyricMarker(x);
      if (lyricHit !== null) {
        e.preventDefault();
        dragLyricRef.current = { index: lyricHit, time: lyricsLines[lyricHit].time! };
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Check loop marker hit
      const hit = hitTestLoopMarker(x);
      if (hit) {
        e.preventDefault();
        setDraggingMarker(hit);
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Start potential drag-to-pan (on touch) or just track position
      dragStartRef.current = { x: e.clientX, viewStart };
      didDragRef.current = false;
    },
    [hitTestEditorEntry, hitTestLoopMarker, hitTestLyricMarker, editorTapMap, lyricsLines, setMarkerSelectedIndex, effectiveViewDuration, viewStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Update tracked pointer
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Pinch zoom
      if (pointersRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.abs(pts[0].x - pts[1].x);
        if (dist < 1) return;
        const scale = pinchStartRef.current.dist / dist;
        const newDuration = Math.max(MIN_VIEW, Math.min(duration || Infinity, pinchStartRef.current.viewDuration * scale));
        const centerSeconds = pixelToSeconds(pinchStartRef.current.centerX, sizeRef.current.width);
        const newStart = centerSeconds - (pinchStartRef.current.centerX / sizeRef.current.width) * newDuration;
        setViewDuration(newDuration);
        setViewStart(clampViewStart(newStart, newDuration));
        return;
      }

      // Single pointer: drag tapMap editor entry
      if (dragEditorEntryRef.current) {
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        dragEditorEntryRef.current.time = Math.max(0, Math.min(seconds, duration || 0));
        suppressClickRef.current = true;
        return;
      }

      // Single pointer: drag lyric marker
      if (dragLyricRef.current) {
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        dragLyricRef.current.time = Math.max(0, Math.min(seconds, duration || 0));
        suppressClickRef.current = true;
        return;
      }

      // Single pointer: drag loop marker
      if (draggingMarker) {
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        const clamped = Math.max(0, Math.min(seconds, duration || 0));
        if (draggingMarker === 'A') {
          engine.setLoop(clamped, loopB);
        } else {
          engine.setLoop(loopA, clamped);
        }
        suppressClickRef.current = true;
        return;
      }

      // Single-finger drag-to-pan (when zoomed)
      if (dragStartRef.current && isZoomed) {
        const dx = e.clientX - dragStartRef.current.x;
        if (!didDragRef.current && Math.abs(dx) < DRAG_THRESHOLD) return;
        didDragRef.current = true;
        const { width } = sizeRef.current;
        if (width === 0) return;
        const secondsPerPixel = effectiveViewDuration / width;
        const newStart = dragStartRef.current.viewStart - dx * secondsPerPixel;
        setViewStart(clampViewStart(newStart, effectiveViewDuration));
        setFollowPlayhead(false);
        return;
      }

      // Hover effects (non-touch only)
      if (!isCoarse) {
        const editorIdx = hitTestEditorEntry(x);
        const lyricIdx = hitTestLyricMarker(x);
        const hit = hitTestLoopMarker(x);
        setCursorStyle(editorIdx !== null || lyricIdx !== null || hit ? 'col-resize' : 'pointer');
        setHoveredTime(findSnapMarker(x));
      }
    },
    [draggingMarker, findSnapMarker, hitTestEditorEntry, hitTestLoopMarker, hitTestLyricMarker, pixelToSeconds, duration, engine, loopA, loopB, clampViewStart, isZoomed, effectiveViewDuration, setFollowPlayhead],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);

      // End pinch
      if (pinchStartRef.current) {
        if (pointersRef.current.size < 2) {
          pinchStartRef.current = null;
        }
        dragStartRef.current = null;
        return;
      }

      // End tapMap editor entry drag (or click-select)
      if (dragEditorEntryRef.current) {
        const { index, time } = dragEditorEntryRef.current;
        // Only commit a move if the pointer actually moved enough
        // to qualify as a drag. A plain click just selects.
        if (didDragRef.current) {
          moveMarkerEntry(index, time);
          suppressClickRef.current = true;
        }
        dragEditorEntryRef.current = null;
        dragStartRef.current = null;
        return;
      }

      // End lyric marker drag
      if (dragLyricRef.current) {
        moveLyricLine(dragLyricRef.current.index, dragLyricRef.current.time);
        dragLyricRef.current = null;
        suppressClickRef.current = true;
        dragStartRef.current = null;
        return;
      }

      // End loop marker drag
      if (draggingMarker) {
        suppressClickRef.current = true;
        setDraggingMarker(null);
        dragStartRef.current = null;
        return;
      }

      // End drag-to-pan — if we dragged, don't seek
      if (didDragRef.current) {
        dragStartRef.current = null;
        didDragRef.current = false;
        return;
      }

      dragStartRef.current = null;

      // Tap to seek
      if (pointersRef.current.size === 0) {
        if (!duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const snap = findSnapMarker(x);
        const seconds = snap ?? pixelToSeconds(x, sizeRef.current.width);
        engine.seek(Math.max(0, Math.min(seconds, duration)));
        setFollowPlayhead(true);
      }
    },
    [draggingMarker, moveLyricLine, moveMarkerEntry, duration, findSnapMarker, pixelToSeconds, engine, setFollowPlayhead],
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);
      setHoveredTime(null);
      if (draggingMarker) {
        setDraggingMarker(null);
      }
      if (pointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      dragLyricRef.current = null;
      dragEditorEntryRef.current = null;
      dragStartRef.current = null;
      didDragRef.current = false;
      setCursorStyle('pointer');
    },
    [draggingMarker],
  );

  // Cmd+scroll zoom, shift+scroll horizontal navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !duration) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Zoom
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const { width } = sizeRef.current;
        if (width === 0) return;

        const cursorSeconds = pixelToSeconds(cursorX, width);
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
        const newDuration = Math.max(MIN_VIEW, Math.min(duration, effectiveViewDuration * zoomFactor));
        // Keep cursor position anchored
        const newStart = cursorSeconds - (cursorX / width) * newDuration;
        setViewDuration(newDuration);
        setViewStart(clampViewStart(newStart, newDuration));
      } else {
        const delta = e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaX;
        if (delta === 0 || !isZoomed) return;
        e.preventDefault();
        const scrollAmount = (delta / 500) * effectiveViewDuration;
        setViewStart((prev) => clampViewStart(prev + scrollAmount, effectiveViewDuration));
        setFollowPlayhead(false);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [duration, effectiveViewDuration, isZoomed, pixelToSeconds, clampViewStart, setFollowPlayhead]);

  // Auto-scroll during playback when zoomed
  useEffect(() => {
    if (!followPlayhead || !isZoomed || !duration) return;
    const rightThreshold = viewStart + effectiveViewDuration * 0.85;
    if (position > rightThreshold || position < viewStart) {
      setViewStart(clampViewStart(position - effectiveViewDuration * 0.25, effectiveViewDuration));
    }
  }, [position, isZoomed, viewStart, effectiveViewDuration, duration, clampViewStart, followPlayhead]);

  // ResizeObserver for main canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      sizeRef.current = { width, height };
      setCanvasReady(true);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ResizeObserver for overview canvas — re-attach when zoom state changes
  useEffect(() => {
    if (!isZoomed) return;
    const container = overviewContainerRef.current;
    const canvas = overviewCanvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      overviewSizeRef.current = { width, height };
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isZoomed]);

  // Draw helper: render markers/tapMap entries onto a canvas context
  const drawMarkers = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      toPixel: (seconds: number) => number,
    ) => {
      const tapMap = displayTapMap;
      if (tapMap && tapMap.length > 0) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'top';

        for (let i = 0; i < tapMap.length; i++) {
          const entry = tapMap[i];
          // Substitute the live drag time for whichever entry is
          // being moved, so the rendered line tracks the cursor.
          const displayTime = markerEditorOpen && dragEditorEntryRef.current?.index === i
            ? dragEditorEntryRef.current.time
            : entry.time;
          const x = toPixel(displayTime);
          if (x < -1 || x > width + 1) continue;

          const isSelected = markerEditorOpen && markerSelectedIndex === i;

          if (entry.type === 'beat') {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 0.5;
          } else if (entry.type === 'measure') {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
          }

          if (isSelected) {
            ctx.shadowColor = '#60a5fa';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
          }

          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          if (isSelected) {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
          }

          if (entry.type === 'section' && entry.label) {
            const textWidth = ctx.measureText(entry.label).width;
            const labelX = Math.min(x + 3, width - textWidth - 4);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(entry.label, labelX + 1, 3);
          }
        }
      } else if (selectedSong) {
        const markers = markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset);
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'top';

        for (const marker of markers) {
          const x = toPixel(marker.seconds);
          if (x < -1 || x > width + 1) continue;

          ctx.strokeStyle = marker.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          const textWidth = ctx.measureText(marker.name).width;
          const labelX = Math.min(x + 3, width - textWidth - 4);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);
          ctx.fillStyle = marker.color;
          ctx.fillText(marker.name, labelX + 1, 3);
        }
      }

      // Lyric markers (when editor is open)
      if (lyricsEditorOpen && lyricsLines.length > 0) {
        ctx.font = '9px ui-monospace, monospace';
        ctx.textBaseline = 'bottom';
        for (let i = 0; i < lyricsLines.length; i++) {
          const t = dragLyricRef.current?.index === i
            ? dragLyricRef.current.time
            : lyricsLines[i].time;
          if (t === null) continue;
          const x = toPixel(t);
          if (x < -1 || x > width + 1) continue;

          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          const label = String(i + 1);
          const tw = ctx.measureText(label).width;
          const lx = Math.min(x - tw / 2, width - tw - 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(Math.max(0, lx - 1), height - 13, tw + 4, 12);
          ctx.fillStyle = '#06b6d4';
          ctx.fillText(label, Math.max(1, lx + 1), height - 2);
        }
      }
    },
    [selectedSong, displayTapMap, markerEditorOpen, markerSelectedIndex, lyricsEditorOpen, lyricsLines],
  );

  // Draw main canvas (viewport-relative)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peakData = engine.peakData;
    if (!peakData || !duration) {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    // Waveform — viewport-relative
    const bucketCount = peakData.length / 2;
    const centerY = height / 2;
    const halfHeight = height / 2 - 2;

    for (let px = 0; px < width; px++) {
      const seconds = viewStart + (px / width) * effectiveViewDuration;
      const fraction = seconds / duration;
      const bucketIndex = Math.floor(fraction * bucketCount);
      if (bucketIndex < 0 || bucketIndex >= bucketCount) continue;

      const min = peakData[bucketIndex * 2];
      const max = peakData[bucketIndex * 2 + 1];
      const y1 = centerY + min * halfHeight;
      const y2 = centerY + max * halfHeight;

      ctx.fillStyle = '#4B5563';
      ctx.fillRect(px, y1, 1, y2 - y1 || 1);
    }

    // Played region tint
    const playheadX = secondsToPixel(position, width);
    if (playheadX > 0) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(0, 0, Math.min(playheadX, width), height);
    }

    // Markers
    drawMarkers(ctx, width, height, (s) => secondsToPixel(s, width));

    // Loop bracket markers and region highlight
    if (loopA !== null || loopB !== null) {
      const loopColor = loopEnabled ? '#eab308' : '#eab30860';
      ctx.strokeStyle = loopColor;
      ctx.lineWidth = 2;
      const bracketW = 6;

      // Fill between brackets when both are set
      if (loopA !== null && loopB !== null) {
        const ax = secondsToPixel(loopA, width);
        const bx = secondsToPixel(loopB, width);
        ctx.fillStyle = loopEnabled ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.06)';
        ctx.fillRect(ax, 0, bx - ax, height);
      }

      // "[" bracket at loop-in
      if (loopA !== null) {
        const ax = secondsToPixel(loopA, width);
        ctx.beginPath();
        ctx.moveTo(ax + bracketW, 0);
        ctx.lineTo(ax, 0);
        ctx.lineTo(ax, height);
        ctx.lineTo(ax + bracketW, height);
        ctx.stroke();
      }

      // "]" bracket at loop-out
      if (loopB !== null) {
        const bx = secondsToPixel(loopB, width);
        ctx.beginPath();
        ctx.moveTo(bx - bracketW, 0);
        ctx.lineTo(bx, 0);
        ctx.lineTo(bx, height);
        ctx.lineTo(bx - bracketW, height);
        ctx.stroke();
      }
    }

    // Hover highlight
    if (hoveredTime !== null) {
      const hx = secondsToPixel(hoveredTime, width);
      if (hx >= 0 && hx <= width) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(hx - 6, 0, 12, height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();
      }
    }

    // Playhead
    if (playheadX >= 0 && playheadX <= width) {
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
    }
  }, [engine.peakData, position, duration, selectedSong, hoveredTime, viewStart, effectiveViewDuration, secondsToPixel, drawMarkers, loopA, loopB, loopEnabled, canvasReady]);

  // Draw overview canvas (full song, only when zoomed)
  useEffect(() => {
    if (!isZoomed) return;
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = overviewSizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peakData = engine.peakData;
    if (!peakData || !duration) return;

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Waveform (full song)
    const bucketCount = peakData.length / 2;
    const centerY = height / 2;
    const halfHeight = height / 2 - 1;

    for (let px = 0; px < width; px++) {
      const bucketIndex = Math.floor((px / width) * bucketCount);
      const min = peakData[bucketIndex * 2];
      const max = peakData[bucketIndex * 2 + 1];
      const y1 = centerY + min * halfHeight;
      const y2 = centerY + max * halfHeight;
      ctx.fillStyle = '#374151';
      ctx.fillRect(px, y1, 1, y2 - y1 || 1);
    }

    // Section markers only (keep overview clean)
    const tapMap = selectedSong?.tapMap;
    if (tapMap) {
      for (const entry of tapMap as TapMapEntry[]) {
        if (entry.type !== 'section') continue;
        const x = (entry.time / duration) * width;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Loop region on overview
    if (loopA !== null || loopB !== null) {
      ctx.strokeStyle = loopEnabled ? '#eab308' : '#eab30860';
      ctx.lineWidth = 1;
      if (loopA !== null && loopB !== null) {
        const oax = (loopA / duration) * width;
        const obx = (loopB / duration) * width;
        ctx.fillStyle = loopEnabled ? 'rgba(234, 179, 8, 0.2)' : 'rgba(234, 179, 8, 0.08)';
        ctx.fillRect(oax, 0, obx - oax, height);
      }
      if (loopA !== null) {
        const oax = (loopA / duration) * width;
        ctx.beginPath(); ctx.moveTo(oax, 0); ctx.lineTo(oax, height); ctx.stroke();
      }
      if (loopB !== null) {
        const obx = (loopB / duration) * width;
        ctx.beginPath(); ctx.moveTo(obx, 0); ctx.lineTo(obx, height); ctx.stroke();
      }
    }

    // Viewport indicator
    const vx1 = (viewStart / duration) * width;
    const vx2 = ((viewStart + effectiveViewDuration) / duration) * width;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(vx1, 0, vx2 - vx1, height);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx1, 0, vx2 - vx1, height);

    // Playhead
    const phx = (position / duration) * width;
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(Math.round(phx) - 0.5, 0, 1.5, height);
  }, [engine.peakData, position, duration, selectedSong, isZoomed, viewStart, effectiveViewDuration, loopA, loopB, loopEnabled]);

  // Overview click: seek + center viewport
  const handleOverviewClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const seconds = (x / rect.width) * duration;
      engine.seek(Math.max(0, Math.min(seconds, duration)));
      setViewStart(clampViewStart(seconds - effectiveViewDuration / 2, effectiveViewDuration));
    },
    [engine, duration, effectiveViewDuration, clampViewStart],
  );

  // Mobile zoom controls
  const handleZoom = useCallback(
    (direction: 'in' | 'out') => {
      if (!duration) return;
      const { width } = sizeRef.current;
      if (width === 0) return;
      const centerSeconds = viewStart + effectiveViewDuration / 2;
      const factor = direction === 'in' ? 0.6 : 1.6;
      const newDuration = Math.max(MIN_VIEW, Math.min(duration, effectiveViewDuration * factor));
      const newStart = centerSeconds - newDuration / 2;
      setViewDuration(newDuration);
      setViewStart(clampViewStart(newStart, newDuration));
    },
    [duration, viewStart, effectiveViewDuration, clampViewStart],
  );

  return (
    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
      {/* Main waveform */}
      <div
        ref={containerRef}
        data-waveform-timeline
        className="h-[80px] md:h-[108px] relative rounded overflow-hidden"
        style={{ cursor: cursorStyle, touchAction: 'none' }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onContextMenu={handleContextMenu}
        />
        {markerContextMenu && contextMenuEntry && (
          <div
            data-marker-context-menu
            className="absolute z-30 rounded border border-gray-600 bg-gray-800 shadow-lg text-xs text-gray-100 overflow-hidden"
            style={{
              left: Math.max(0, Math.min(markerContextMenu.x, sizeRef.current.width - 140)),
              top: Math.max(0, Math.min(markerContextMenu.y, sizeRef.current.height - 96)),
              minWidth: 132,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-700">
              Change type
            </div>
            {(['section', 'measure', 'beat'] as const).map((t) => {
              const isCurrent = contextMenuEntry.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => handleChangeMarkerType(t)}
                  className={`w-full text-left px-2 py-1.5 flex items-center justify-between transition-colors ${
                    isCurrent
                      ? 'bg-gray-700/60 text-gray-400 cursor-default'
                      : 'hover:bg-blue-900/40 text-gray-100'
                  }`}
                >
                  <span className="capitalize">{t}</span>
                  {isCurrent && <span className="text-[10px]">current</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Overview bar + zoom controls — only visible when zoomed */}
      {isZoomed && (
        <div className="flex items-center gap-1">
          {/* Zoom buttons — mobile only */}
          <button
            className="md:hidden w-7 h-5 flex items-center justify-center text-xs text-gray-400 bg-gray-700 rounded hover:bg-gray-600"
            onClick={() => handleZoom('out')}
            title="Zoom out"
          >
            −
          </button>
          <div
            ref={overviewContainerRef}
            className="flex-1 h-5 relative cursor-pointer rounded overflow-hidden border border-gray-700/50"
          >
            <canvas
              ref={overviewCanvasRef}
              className="w-full h-full"
              onClick={handleOverviewClick}
            />
          </div>
          <button
            className="md:hidden w-7 h-5 flex items-center justify-center text-xs text-gray-400 bg-gray-700 rounded hover:bg-gray-600"
            onClick={() => handleZoom('in')}
            title="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
