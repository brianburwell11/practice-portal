import { useRef, useEffect, useCallback, useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import type { TapMapEntry } from '../../audio/types';
import { markersToSeconds } from '../../audio/tempoUtils';

/** Snap threshold in pixels — how close the cursor must be to a marker to snap. */
const SNAP_PX = 12;

export function WaveformTimeline() {
  const engine = useAudioEngine();
  const { position, duration } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);

  // Find the nearest snappable marker (section or measure) near a pixel X.
  // Returns its time in seconds, or null if none within SNAP_PX.
  const findSnapMarker = useCallback(
    (pixelX: number): number | null => {
      if (!duration || !selectedSong) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;

      const tapMap = selectedSong.tapMap;
      if (tapMap && tapMap.length > 0) {
        let closest: { time: number; dist: number } | null = null;
        for (const entry of tapMap as TapMapEntry[]) {
          if (entry.type === 'beat') continue; // only snap to sections and measures
          const markerX = (entry.time / duration) * width;
          const dist = Math.abs(pixelX - markerX);
          if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
            closest = { time: entry.time, dist };
          }
        }
        return closest?.time ?? null;
      }

      // Legacy tempoMap mode
      const markers = markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset);
      let closest: { time: number; dist: number } | null = null;
      for (const marker of markers) {
        const markerX = (marker.seconds / duration) * width;
        const dist = Math.abs(pixelX - markerX);
        if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
          closest = { time: marker.seconds, dist };
        }
      }
      return closest?.time ?? null;
    },
    [duration, selectedSong],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const snap = findSnapMarker(x);
      const seconds = snap ?? (x / rect.width) * duration;
      engine.seek(Math.max(0, Math.min(seconds, duration)));
    },
    [engine, duration, findSnapMarker],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoveredTime(findSnapMarker(x));
    },
    [findSnapMarker],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredTime(null);
  }, []);

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

    // Draw timing markers (tapMap or legacy markers)
    const tapMap = selectedSong?.tapMap;
    if (tapMap && tapMap.length > 0) {
      // TapMap mode: draw sections, measures, beats
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'top';

      for (const entry of tapMap as TapMapEntry[]) {
        const x = (entry.time / duration) * width;
        if (x < 0 || x > width) continue;

        if (entry.type === 'beat') {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 0.5;
        } else if (entry.type === 'measure') {
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 0.5;
        } else {
          // section
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Label for sections
        if (entry.type === 'section' && entry.label) {
          const textWidth = ctx.measureText(entry.label).width;
          const labelX = Math.min(x + 3, width - textWidth - 4);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(entry.label, labelX + 1, 3);
        }
      }
    } else {
      // Legacy tempoMap mode: draw markers
      const markers = selectedSong
        ? markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset)
        : [];
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'top';

      for (const marker of markers) {
        const x = (marker.seconds / duration) * width;
        if (x < 0 || x > width) continue;

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

    // Draw hover highlight on snapped marker
    if (hoveredTime !== null) {
      const hx = (hoveredTime / duration) * width;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(hx - 6, 0, 12, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, height);
      ctx.stroke();
    }

    // Draw playhead
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
  }, [engine.peakData, position, duration, selectedSong, hoveredTime]);

  return (
    <div
      ref={containerRef}
      className="flex-1 h-12 relative cursor-pointer rounded overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
