import { useRef, useEffect, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import {
  beatToSeconds,
  secondsToBeat,
  snapToNearestBeat,
  generateBeatGrid,
} from '../../audio/tempoUtils';

interface MarkerEditorCanvasProps {
  viewStart: number;
  viewDuration: number;
  onViewChange: (newViewStart: number) => void;
}

export function MarkerEditorCanvas({ viewStart, viewDuration, onViewChange }: MarkerEditorCanvasProps) {
  const engine = useAudioEngine();
  const { position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const {
    markers,
    beatOffset,
    editingMarkerIndex,
    addMarker,
    moveMarker,
    setEditingMarker,
  } = useMarkerEditorStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{ markerIndex: number; active: boolean } | null>(null);
  const dragBeatRef = useRef<number | null>(null);
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

  // Shift+Scroll / trackpad horizontal scroll for manual navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !duration) return;

    const handleWheel = (e: WheelEvent) => {
      // Handle both shift+scroll (e.shiftKey with deltaY) and trackpad horizontal scroll (deltaX)
      const delta = e.shiftKey ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      e.preventDefault();
      const scrollAmount = (delta / 500) * viewDuration;
      const newStart = Math.max(0, Math.min(duration - viewDuration, viewStart + scrollAmount));
      onViewChange(newStart);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [viewStart, viewDuration, duration, onViewChange]);

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
        // Scroll so playhead is at 25% from left
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

    // 3. Beat grid
    const grid = generateBeatGrid(
      selectedSong.tempoMap,
      selectedSong.timeSignatureMap,
      beatOffset,
      duration,
    );

    for (const line of grid) {
      const x = secondsToPixel(line.seconds, width);
      if (x < 0 || x > width) continue;

      if (line.isBarLine) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // 4. Markers
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'top';

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const isEditing = editingMarkerIndex === i;
      const isDragging = dragRef.current?.active && dragRef.current.markerIndex === i;
      const displayBeat = isDragging && dragBeatRef.current !== null ? dragBeatRef.current : marker.beat;
      const seconds = beatToSeconds(displayBeat, selectedSong.tempoMap, beatOffset);
      const x = secondsToPixel(seconds, width);
      if (x < 0 || x > width) continue;

      // Glow for editing marker
      if (isEditing) {
        ctx.shadowColor = marker.color;
        ctx.shadowBlur = 8;
      }

      ctx.strokeStyle = marker.color;
      ctx.lineWidth = isEditing ? 2.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Label background
      const textWidth = ctx.measureText(marker.name).width;
      const labelX = Math.min(x + 3, width - textWidth - 4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(labelX - 1, 1, textWidth + 4, 15);

      // Label text
      ctx.fillStyle = marker.color;
      ctx.fillText(marker.name, labelX + 1, 3);
    }

    // 5. Playhead
    const playheadX = secondsToPixel(position, width);
    if (playheadX >= 0 && playheadX <= width) {
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
    }
  }, [engine.peakData, position, duration, selectedSong, markers, beatOffset, editingMarkerIndex, viewStart, viewDuration, secondsToPixel, onViewChange]);

  // Playhead animation during playback
  useEffect(() => {
    const { playing } = useTransportStore.getState();
    if (!playing) return;

    const tick = () => {
      // The draw effect above already triggers on position change via the store.
      // We just need to make sure position updates propagate.
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [useTransportStore().playing]);

  // Helper: find marker index near a pixel X
  const findMarkerNearX = useCallback(
    (clickX: number): number | null => {
      if (!selectedSong || !duration) return null;
      const { width } = sizeRef.current;

      for (let i = 0; i < markers.length; i++) {
        const seconds = beatToSeconds(markers[i].beat, selectedSong.tempoMap, beatOffset);
        const markerX = secondsToPixel(seconds, width);
        if (Math.abs(clickX - markerX) < 8) return i;
      }
      return null;
    },
    [markers, selectedSong, duration, beatOffset, secondsToPixel],
  );

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration || !selectedSong) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;

      const nearIndex = findMarkerNearX(clickX);

      if (nearIndex !== null) {
        // Start drag
        dragRef.current = { markerIndex: nearIndex, active: false };
        setEditingMarker(nearIndex);

        const handleMouseMove = (ev: MouseEvent) => {
          if (!dragRef.current) return;
          dragRef.current.active = true;

          const mx = ev.clientX - rect.left;
          const clickSeconds = pixelToSeconds(mx, sizeRef.current.width);
          const beat = snapToNearestBeat(
            secondsToBeat(clickSeconds, selectedSong.tempoMap, beatOffset),
          );
          dragBeatRef.current = beat;
        };

        const handleMouseUp = () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);

          if (dragRef.current?.active && dragBeatRef.current !== null) {
            moveMarker(dragRef.current.markerIndex, dragBeatRef.current);
          }
          dragRef.current = null;
          dragBeatRef.current = null;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      } else {
        // Click on empty space: add marker
        const clickSeconds = pixelToSeconds(clickX, sizeRef.current.width);
        const beat = snapToNearestBeat(
          secondsToBeat(clickSeconds, selectedSong.tempoMap, beatOffset),
        );
        addMarker({ name: `Beat ${beat}`, beat, color: '#22c55e' });
        // Find the new marker's index after sort
        const newMarkers = useMarkerEditorStore.getState().markers;
        const newIndex = newMarkers.findIndex((m) => m.beat === beat);
        if (newIndex >= 0) setEditingMarker(newIndex);
      }
    },
    [duration, selectedSong, beatOffset, findMarkerNearX, addMarker, moveMarker, setEditingMarker, pixelToSeconds],
  );

  // Keyboard: 'M' to add marker at current position
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        // Don't capture if user is typing in an input
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        )
          return;

        if (!selectedSong || !duration) return;

        const { playing } = useTransportStore.getState();
        if (!playing) return;

        const currentPos = engine.clock.currentTime;
        const beat = snapToNearestBeat(
          secondsToBeat(currentPos, selectedSong.tempoMap, beatOffset),
        );
        addMarker({ name: `Beat ${beat}`, beat, color: '#22c55e' });
        const newMarkers = useMarkerEditorStore.getState().markers;
        const newIndex = newMarkers.findIndex((m) => m.beat === beat);
        if (newIndex >= 0) setEditingMarker(newIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engine, selectedSong, duration, beatOffset, addMarker, setEditingMarker]);

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
