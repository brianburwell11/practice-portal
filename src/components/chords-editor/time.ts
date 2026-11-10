/** `m:ss.ss`, for chord times in the editor. */
export function formatPrecise(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}
