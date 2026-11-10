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
    const from = Math.max(0, Math.floor(firstBucket + px * bucketsPerPx));
    const to = Math.min(peaks.length, Math.max(from + 1, Math.floor(firstBucket + (px + 1) * bucketsPerPx)));
    if (from >= to) continue;
    let amp = 0;
    for (let i = from; i < to; i++) if (peaks[i] > amp) amp = peaks[i];
    const h = amp * halfHeight;
    ctx.fillRect(px, centerY - h, 1, Math.max(1, h * 2));
  }
}
