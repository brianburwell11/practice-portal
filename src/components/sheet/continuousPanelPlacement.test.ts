import { describe, expect, it } from 'vitest';
import type { ContinuousPanel } from './EngravedStripRenderer';
import { PANEL_GAP_PX, placePanel } from './continuousPanelPlacement';

/** A stand-in panel of a fixed width whose header begins at content x `header`. */
function fakePanel(width: number, header = 200): ContinuousPanel & { asked: number[] } {
  const asked: number[] = [];
  return {
    canvas: null as unknown as HTMLCanvasElement,
    headerContentX: header,
    asked,
    update(contentX) { asked.push(contentX); return width; },
  };
}

const FOCUS = 300; // the reading point, viewport px
const ROOM = FOCUS - PANEL_GAP_PX;

describe('placePanel', () => {
  it('shows nothing without a panel or without room', () => {
    expect(placePanel(null, 0, FOCUS, { current: 0 })).toBeNull();
    expect(placePanel(fakePanel(100), 0, PANEL_GAP_PX, { current: 0 })).toBeNull();
  });

  it('rides over the score header while that is still right of the left edge', () => {
    // Header at content 200, scrolled 150: it is at viewport 50.
    const box = placePanel(fakePanel(100), 150, FOCUS, { current: 100 });
    expect(box).toEqual({ left: 50, width: 100, offset: 0 });
  });

  it('pins at the left edge once the header has scrolled past it', () => {
    const box = placePanel(fakePanel(100), 900, FOCUS, { current: 100 });
    expect(box).toEqual({ left: 0, width: 100, offset: 0 });
  });

  it('asks for the contents at where it is shown', () => {
    const panel = fakePanel(100);
    placePanel(panel, 900, FOCUS, { current: 100 });
    expect(panel.asked.at(-1)).toBe(900); // viewport 0 + scroll 900
  });

  it('never reaches the reading point: a wide panel shifts left and is cut off', () => {
    const box = placePanel(fakePanel(ROOM + 80), 900, FOCUS, { current: ROOM + 80 });
    expect(box).toEqual({ left: 0, width: ROOM, offset: -80 });
  });

  it('is hidden while the header itself would run into the reading point', () => {
    // Header at viewport 250 with a 100 px panel would end past the room.
    expect(placePanel(fakePanel(100), -50, FOCUS, { current: 100 })).toBeNull();
  });

  it('refines its first width guess and remembers the width', () => {
    const widthRef = { current: 0 };
    const box = placePanel(fakePanel(120), 900, FOCUS, widthRef);
    expect(widthRef.current).toBe(120);
    expect(box?.width).toBe(120);
  });

  it('is hidden when the panel has nothing to draw', () => {
    const panel = { ...fakePanel(100), update: () => null };
    expect(placePanel(panel, 900, FOCUS, { current: 100 })).toBeNull();
  });
});
