import { useRef, useEffect, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useMarkerEditorStore } from '../../store/markerEditorStore';

interface TimelineNavigatorProps {
  viewStart: number;
  viewDuration: number;
  onViewChange: (newViewStart: number) => void;
  onSeek: (seconds: number) => void;
}

export function TimelineNavigator({
  viewStart,
  viewDuration,
  onViewChange,
  onSeek,
}: TimelineNavigatorProps) {
  const engine = useAudioEngine();
  const { position, duration } = useTransportStore();
  const tapMap = useMarkerEditorStore((s) => s.tapMap);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Drag state refs
  const isDragging = useRef(false);
  const dragMode = useRef<'seek' | 'viewport'>('seek');
  const dragOffset = useRef(0);

  // ResizeObserver to track canvas container size
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

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.clearRect(0, 0, width, height);

    const peakData = engine.peakData;

    if (!peakData || !duration) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // 1. Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // 2. Waveform
    const bucketCount = peakData.length / 2;
    const centerY = height / 2;
    const halfHeight = height / 2 - 2;

    for (let px = 0; px < width; px++) {
      const bucketIndex = Math.floor((px / width) * bucketCount);
      const min = peakData[bucketIndex * 2];
      const max = peakData[bucketIndex * 2 + 1];

      const y1 = centerY + min * halfHeight;
      const y2 = centerY + max * halfHeight;

      ctx.fillStyle = '#374151';
      ctx.fillRect(px, y1, 1, y2 - y1 || 1);
    }

    // 3. TapMap entries
    for (const entry of tapMap) {
      const x = (entry.time / duration) * width;
      if (x < 0 || x > width) continue;

      if (entry.type === 'section') {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
      } else if (entry.type === 'measure') {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
      }

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // 4. Viewport indicator
    const x1 = (viewStart / duration) * width;
    const x2 = ((viewStart + viewDuration) / duration) * width;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(x1, 0, x2 - x1, height);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, 0, x2 - x1, height);

    // 5. Playhead
    const playheadX = (position / duration) * width;
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(Math.round(playheadX) - 0.75, 0, 1.5, height);
  }, [engine.peakData, position, duration, viewStart, viewDuration, tapMap]);

  const clampViewStart = useCallback(
    (vs: number) => Math.max(0, Math.min(vs, duration - viewDuration)),
    [duration, viewDuration],
  );

  const getSecondsFromMouseEvent = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !duration) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return Math.max(0, Math.min((x / rect.width) * duration, duration));
    },
    [duration],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const width = rect.width;

      // Viewport indicator bounds in pixels
      const vpLeft = (viewStart / duration) * width;
      const vpRight = ((viewStart + viewDuration) / duration) * width;

      if (mouseX >= vpLeft && mouseX <= vpRight) {
        // Click inside viewport indicator -> drag viewport
        isDragging.current = true;
        dragMode.current = 'viewport';
        dragOffset.current = mouseX - vpLeft;

        const onMouseMove = (ev: MouseEvent) => {
          const r = canvasRef.current?.getBoundingClientRect();
          if (!r) return;
          const mx = ev.clientX - r.left;
          const newVpLeft = mx - dragOffset.current;
          const newViewStart = (newVpLeft / r.width) * duration;
          onViewChange(clampViewStart(newViewStart));
        };

        const onMouseUp = () => {
          isDragging.current = false;
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      } else {
        // Click outside viewport -> seek + center viewport
        isDragging.current = true;
        dragMode.current = 'seek';

        const clickSeconds = getSecondsFromMouseEvent(e);
        onSeek(clickSeconds);
        onViewChange(clampViewStart(clickSeconds - viewDuration / 2));

        const onMouseMove = (ev: MouseEvent) => {
          const seconds = getSecondsFromMouseEvent(ev);
          onSeek(seconds);
          onViewChange(clampViewStart(seconds - viewDuration / 2));
        };

        const onMouseUp = () => {
          isDragging.current = false;
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    },
    [duration, viewStart, viewDuration, onViewChange, onSeek, clampViewStart, getSecondsFromMouseEvent],
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-10 relative cursor-pointer rounded overflow-hidden border border-gray-700/50"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
