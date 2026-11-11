/**
 * Draw the engine's mix waveform (peak amplitude per bucket, song time) as a
 * symmetric shape. Each pixel shows the loudest bucket it covers, so nothing
 * gets skipped when zoomed out.
 */
export function drawPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  peaksPerSecond: number,
  viewStart: number,
  viewDuration: number,
  width: number,
  centerY: number,
  halfHeight: number,
  color: string,
): void {
  if (width <= 0 || viewDuration <= 0) return;
  ctx.fillStyle = color;
  const bucketsPerPx = (viewDuration * peaksPerSecond) / width;
  const firstBucket = viewStart * peaksPerSecond;
  for (let px = 0; px < width; px++) {
    const start = firstBucket + px * bucketsPerPx;
    const end = start + bucketsPerPx;
    // Nothing here when the view starts before the audio does (an offset stem).
    if (end <= 0 || start >= peaks.length) continue;
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(peaks.length, Math.max(from + 1, Math.floor(end)));
    let amp = 0;
    for (let i = from; i < to; i++) if (peaks[i] > amp) amp = peaks[i];
    const h = amp * halfHeight;
    ctx.fillRect(px, centerY - h, 1, Math.max(1, h * 2));
  }
}
