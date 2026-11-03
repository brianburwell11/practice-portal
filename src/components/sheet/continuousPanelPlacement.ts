import type { ContinuousPanel } from './EngravedStripRenderer';

/** Gap between the continuous panel and the reading point. */
export const PANEL_GAP_PX = 6;

/** Where the continuous panel shows: `left`/`width` of the visible box, and
 *  `offset` (≤ 0) to shift its canvas when the start of it is cut off. */
export interface PanelBox {
  left: number;
  width: number;
  offset: number;
}

/**
 * Places the continuous panel, like CSS `position: sticky`: over the score's
 * own header and moving with it as it scrolls, until it reaches the strip's
 * left edge, where it stays. It never reaches the reading point
 * (`focusLeftPx`, viewport px): pinned, if it's wider than the room before
 * it, it shifts left and the start of the staff names is cut off; and while
 * the score's own header is still under or past the reading point it isn't
 * shown (the header itself is there). Its width depends on what it shows, so
 * the last width is the first guess and it is asked again once if that
 * changed. Null when not shown.
 */
export function placePanel(
  panel: ContinuousPanel | null,
  scrollLeft: number,
  focusLeftPx: number,
  widthRef: { current: number },
): PanelBox | null {
  if (!panel) return null;
  const room = focusLeftPx - PANEL_GAP_PX;
  if (room <= 0) return null;
  const natural = panel.headerContentX - scrollLeft;
  const leftFor = (width: number) => Math.max(Math.min(0, room - width), natural);
  let width = widthRef.current;
  for (let attempt = 0; attempt < 2; attempt++) {
    const w = panel.update(scrollLeft + leftFor(width));
    if (w === null) return null;
    const settled = Math.abs(w - width) < 0.5;
    width = w;
    if (settled) break;
  }
  widthRef.current = width;
  const left = leftFor(width);
  if (left + width > room + 0.5) return null;
  const visibleLeft = Math.max(0, left);
  return { left: visibleLeft, width: left + width - visibleLeft, offset: left - visibleLeft };
}
