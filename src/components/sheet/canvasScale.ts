/**
 * Device pixels per CSS pixel for drawing scores into canvases, at most 2.
 * iPhones are 3x, which makes every tile 2.25 times the pixels of 2x with no
 * visible gain for engraved notation, and iOS caps the canvas memory a page
 * may use. Past that cap canvases fail and the page bogs down.
 */
export function scoreCanvasDpr(): number {
  return Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}
