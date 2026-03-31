import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { markersToSeconds } from '../../audio/tempoUtils';

export function WaveformTimeline() {
  const engine = useAudioEngine();
  const { position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const markers = useMemo(() => {
    if (!selectedSong) return [];
    return markersToSeconds(selectedSong.markers, selectedSong.tempoMap);
  }, [selectedSong]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const seconds = (x / rect.width) * duration;
      engine.seek(Math.max(0, Math.min(seconds, duration)));
    },
    [engine, duration],
  );

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

  // Draw waveform, markers, and playhead
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
      // Empty state
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    const bucketCount = peakData.length / 2;
    const centerY = height / 2;
    const halfHeight = height / 2 - 2; // 2px padding top/bottom

    // Draw waveform
    for (let px = 0; px < width; px++) {
      // Map pixel to peak bucket
      const bucketIndex = Math.floor((px / width) * bucketCount);
      const min = peakData[bucketIndex * 2];
      const max = peakData[bucketIndex * 2 + 1];

      const y1 = centerY + min * halfHeight;
      const y2 = centerY + max * halfHeight;

      ctx.fillStyle = '#4B5563';
      ctx.fillRect(px, y1, 1, y2 - y1 || 1);
    }

    // Played region tint
    const playheadX = (position / duration) * width;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fillRect(0, 0, playheadX, height);

    // Draw markers
    const markerLabelY = 12;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'top';

    for (const marker of markers) {
      const x = (marker.seconds / duration) * width;
      if (x < 0 || x > width) continue;

      // Vertical line
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Label background
      const textWidth = ctx.measureText(marker.name).width;
      const labelX = Math.min(x + 3, width - textWidth - 4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);

      // Label text
      ctx.fillStyle = marker.color;
      ctx.fillText(marker.name, labelX + 1, markerLabelY - 9);
    }

    // Draw playhead
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
  }, [engine.peakData, position, duration, markers]);

  return (
    <div
      ref={containerRef}
      className="flex-1 h-12 relative cursor-pointer rounded overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onClick={handleClick}
      />
    </div>
  );
}
