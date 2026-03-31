import { useRef, useEffect, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import { autoLabelSection } from '../../audio/tapMapUtils';

interface MarkerEditorCanvasProps {
  viewStart: number;
  viewDuration: number;
  onViewChange: (newViewStart: number) => void;
  onViewDurationChange: (newDuration: number) => void;
}

export function MarkerEditorCanvas({
  viewStart,
  viewDuration,
  onViewChange,
  onViewDurationChange,
}: MarkerEditorCanvasProps) {
  const engine = useAudioEngine();
  const { position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const {
    tapMap,
    selectedIndex,
    tapping,
    addEntry,
    moveEntry,
    setSelectedIndex,
    undo,
  } = useMarkerEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{ entryIndex: number; active: boolean } | null>(null);
  const dragTimeRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);

  // Viewport coordinate conversion helpers
  const secondsToPixel = useCallback(
    (seconds: number, width: number) => ((seconds - viewStart) / viewDuration) * width,
    [viewStart, viewDuration],
  );

  const pixelToSeconds = useCallback(
    (px: number, width: number) => viewStart + (px / width) * viewDuration,
    [viewStart, viewDuration],
  );

  // ResizeObserver
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

  // Wheel handler: zoom + horizontal scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !duration) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Zoom
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const { width } = sizeRef.current;
        const cursorX = e.clientX - rect.left;
        const cursorSeconds = pixelToSeconds(cursorX, width);
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const newDuration = Math.max(5, Math.min(duration, viewDuration * zoomFactor));
        const newStart = cursorSeconds - (cursorX / width) * newDuration;
        onViewDurationChange(newDuration);
        onViewChange(Math.max(0, Math.min(duration - newDuration, newStart)));
      } else if (e.shiftKey || e.deltaX !== 0) {
        // Horizontal scroll
        e.preventDefault();
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        const scrollAmount = (delta / 500) * viewDuration;
        const newStart = Math.max(0, Math.min(duration - viewDuration, viewStart + scrollAmount));
        onViewChange(newStart);
      }
      // Otherwise: ignore, let propagate
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [viewStart, viewDuration, duration, onViewChange, onViewDurationChange, pixelToSeconds]);

  // Draw loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const peakData = engine.peakData;

    if (!peakData || !duration || !selectedSong) {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Auto-scroll during playback
    const { playing } = useTransportStore.getState();
    if (playing) {
      const rightEdge = viewStart + viewDuration;
      const nearRightThreshold = viewStart + viewDuration * 0.85;
      if (position > nearRightThreshold || position < viewStart || position > rightEdge) {
        const newStart = Math.max(
          0,
          Math.min(duration - viewDuration, position - viewDuration * 0.25),
        );
        onViewChange(newStart);
      }
    }

    // 1. Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    // 2. Waveform — only draw the visible viewport portion
    const bucketCount = peakData.length / 2;
    const centerY = height / 2;
    const halfHeight = height / 2 - 2;

    for (let px = 0; px < width; px++) {
      const seconds = viewStart + (px / width) * viewDuration;
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

    // 3. TapMap entries
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'top';

    for (let i = 0; i < tapMap.length; i++) {
      const entry = tapMap[i];
      const isDragging = dragRef.current?.active && dragRef.current.entryIndex === i;
      const displayTime = isDragging && dragTimeRef.current !== null ? dragTimeRef.current : entry.time;
      const x = secondsToPixel(displayTime, width);
      if (x < 0 || x > width) continue;

      const isSelected = selectedIndex === i;

      if (entry.type === 'section') {
        // Section: bold amber line with label
        if (isSelected) {
          ctx.shadowColor = '#f59e0b';
          ctx.shadowBlur = 8;
        }
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Label
        if (entry.label) {
          const textWidth = ctx.measureText(entry.label).width;
          const labelX = Math.min(x + 3, width - textWidth - 4);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(labelX - 1, 1, textWidth + 4, 15);
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(entry.label, labelX + 1, 3);
        }
      } else if (entry.type === 'measure') {
        // Measure: medium white line
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      } else {
        // Beat: thin white line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // 4. Playhead
    const playheadX = secondsToPixel(position, width);
    if (playheadX >= 0 && playheadX <= width) {
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
    }
  }, [engine.peakData, position, duration, selectedSong, tapMap, selectedIndex, viewStart, viewDuration, secondsToPixel, onViewChange]);

  // Playhead animation during playback
  useEffect(() => {
    const { playing } = useTransportStore.getState();
    if (!playing) return;

    const tick = () => {
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [useTransportStore().playing]);

  // Helper: find tapMap entry index near a pixel X
  const findEntryNearX = useCallback(
    (clickX: number): number | null => {
      if (!duration) return null;
      const { width } = sizeRef.current;

      for (let i = 0; i < tapMap.length; i++) {
        const entryX = secondsToPixel(tapMap[i].time, width);
        if (Math.abs(clickX - entryX) < 8) return i;
      }
      return null;
    },
    [tapMap, duration, secondsToPixel],
  );

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      const nearIndex = findEntryNearX(clickX);

      if (nearIndex !== null) {
        // Select and start drag
        setSelectedIndex(nearIndex);
        dragRef.current = { entryIndex: nearIndex, active: false };

        const handleMouseMove = (ev: MouseEvent) => {
          if (!dragRef.current) return;
          dragRef.current.active = true;

          const mx = ev.clientX - rect.left;
          const newTime = pixelToSeconds(mx, sizeRef.current.width);
          dragTimeRef.current = Math.max(0, Math.min(duration, newTime));
        };

        const handleMouseUp = () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);

          if (dragRef.current?.active && dragTimeRef.current !== null) {
            moveEntry(dragRef.current.entryIndex, dragTimeRef.current);
          }
          dragRef.current = null;
          dragTimeRef.current = null;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      } else {
        // Click on empty space: seek audio
        const clickSeconds = pixelToSeconds(clickX, sizeRef.current.width);
        engine.seek(clickSeconds);
      }
    },
    [duration, findEntryNearX, setSelectedIndex, moveEntry, pixelToSeconds, engine],
  );

  // Keyboard: S/M/B to add entries, Z to undo (when tapping)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (!tapping) return;
      if (!selectedSong || !duration) return;

      const key = e.key.toUpperCase();

      if (key === 'Z') {
        undo();
        return;
      }

      const { playing } = useTransportStore.getState();
      if (!playing) return;

      const currentPos = engine.clock.currentTime;

      if (key === 'S') {
        const label = autoLabelSection(tapMap);
        addEntry({ time: currentPos, type: 'section', label });
      } else if (key === 'M') {
        addEntry({ time: currentPos, type: 'measure' });
      } else if (key === 'B') {
        addEntry({ time: currentPos, type: 'beat' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, selectedSong, duration, tapping, tapMap, addEntry, undo]);

  return (
    <div
      ref={containerRef}
      className="w-full h-48 relative cursor-crosshair rounded overflow-hidden border border-gray-700"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
