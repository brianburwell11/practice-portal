import { useRef, useEffect, useCallback, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import type { TapMapEntry } from '../../audio/types';
import { markersToSeconds } from '../../audio/tempoUtils';

/** Snap threshold in pixels — how close the cursor must be to a marker to snap. */
const SNAP_PX = 12;
/** Minimum zoom level in seconds */
const MIN_VIEW = 5;

export function WaveformTimeline() {
  const engine = useAudioEngine();
  const { position, duration, loopA, loopB, loopEnabled } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);

  // Main canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Overview canvas refs
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overviewContainerRef = useRef<HTMLDivElement>(null);
  const overviewSizeRef = useRef({ width: 0, height: 0 });

  // Viewport state — starts fully zoomed out
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(Infinity); // Infinity = full duration
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [draggingMarker, setDraggingMarker] = useState<'A' | 'B' | null>(null);
  const suppressClickRef = useRef(false);

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
    setViewDuration(Infinity);
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

      const tapMap = selectedSong.tapMap;
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
    [duration, selectedSong, secondsToPixel],
  );

  // Hit test: check if a pixel X is within 6px of loop A or B marker
  const hitTestLoopMarker = useCallback(
    (pixelX: number): 'A' | 'B' | null => {
      if (loopA === null || loopB === null) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      const ax = secondsToPixel(loopA, width);
      const bx = secondsToPixel(loopB, width);
      // Prefer whichever is closer if both are within range
      const distA = Math.abs(pixelX - ax);
      const distB = Math.abs(pixelX - bx);
      if (distA <= 6 && distB <= 6) return distA <= distB ? 'A' : 'B';
      if (distA <= 6) return 'A';
      if (distB <= 6) return 'B';
      return null;
    },
    [loopA, loopB, secondsToPixel],
  );

  const [cursorStyle, setCursorStyle] = useState<string>('pointer');

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const snap = findSnapMarker(x);
      const seconds = snap ?? pixelToSeconds(x, sizeRef.current.width);
      engine.seek(Math.max(0, Math.min(seconds, duration)));
    },
    [engine, duration, findSnapMarker, pixelToSeconds],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hit = hitTestLoopMarker(x);
      if (hit) {
        e.preventDefault();
        setDraggingMarker(hit);
      }
    },
    [hitTestLoopMarker],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (draggingMarker) {
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        const clamped = Math.max(0, Math.min(seconds, duration || 0));
        if (draggingMarker === 'A') {
          engine.setLoop(clamped, loopB);
        } else {
          engine.setLoop(loopA, clamped);
        }
        return;
      }

      // Update cursor based on loop marker proximity
      const hit = hitTestLoopMarker(x);
      setCursorStyle(hit ? 'col-resize' : 'pointer');

      setHoveredTime(findSnapMarker(x));
    },
    [draggingMarker, findSnapMarker, hitTestLoopMarker, pixelToSeconds, duration, engine, loopA, loopB],
  );

  const handleMouseUp = useCallback(() => {
    if (draggingMarker) {
      suppressClickRef.current = true;
      setDraggingMarker(null);
    }
  }, [draggingMarker]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTime(null);
    if (draggingMarker) {
      setDraggingMarker(null);
    }
    setCursorStyle('pointer');
  }, [draggingMarker]);

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
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        if (delta === 0 || !isZoomed) return;
        e.preventDefault();
        const scrollAmount = (delta / 500) * effectiveViewDuration;
        setViewStart((prev) => clampViewStart(prev + scrollAmount, effectiveViewDuration));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [duration, effectiveViewDuration, isZoomed, pixelToSeconds, clampViewStart]);

  // Auto-scroll during playback when zoomed
  useEffect(() => {
    if (!isZoomed || !duration) return;
    const rightThreshold = viewStart + effectiveViewDuration * 0.85;
    if (position > rightThreshold || position < viewStart) {
      setViewStart(clampViewStart(position - effectiveViewDuration * 0.25, effectiveViewDuration));
    }
  }, [position, isZoomed, viewStart, effectiveViewDuration, duration, clampViewStart]);

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
      const tapMap = selectedSong?.tapMap;
      if (tapMap && tapMap.length > 0) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'top';

        for (const entry of tapMap as TapMapEntry[]) {
          const x = toPixel(entry.time);
          if (x < -1 || x > width + 1) continue;

          if (entry.type === 'beat') {
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 0.5;
          } else if (entry.type === 'measure') {
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 0.5;
          } else {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
          }

          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

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
    },
    [selectedSong],
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
  }, [engine.peakData, position, duration, selectedSong, hoveredTime, viewStart, effectiveViewDuration, secondsToPixel, drawMarkers, loopA, loopB, loopEnabled]);

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

  return (
    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
      {/* Main waveform */}
      <div
        ref={containerRef}
        className="h-[108px] relative rounded overflow-hidden"
        style={{ cursor: cursorStyle }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
      </div>

      {/* Overview bar — only visible when zoomed */}
      {isZoomed && (
        <div
          ref={overviewContainerRef}
          className="h-5 relative cursor-pointer rounded overflow-hidden border border-gray-700/50"
        >
          <canvas
            ref={overviewCanvasRef}
            className="w-full h-full"
            onClick={handleOverviewClick}
          />
        </div>
      )}
    </div>
  );
}
