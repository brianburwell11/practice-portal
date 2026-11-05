import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * Drag-to-reorder for a vertical list, driven by pointer events so it
 * works the same with a mouse, a finger or a pen (HTML5 `draggable`
 * never fires on touch). Drag starts from a handle; the dragged row
 * follows the pointer while the rows it passes slide out of the way, and
 * the list's scroll container auto-scrolls near its edges.
 *
 * Usage:
 *   const sort = useSortableList(onReorder);
 *   <div ref={sort.rowRef(i)} style={sort.rowStyle(i)}>
 *     <span {...sort.handleProps(i)}>☰</span>
 */

const EDGE_PX = 40;
const MAX_SCROLL_STEP = 12;

interface DragState {
  from: number;
  pointerId: number;
  startClientY: number;
  lastClientY: number;
  startScrollTop: number;
  scroller: HTMLElement | null;
  /** Row midpoints in scroll-content coordinates, measured at drag start. */
  mids: number[];
  /** Height of the dragged row plus the gap to its neighbour. */
  slot: number;
  target: number;
}

function findScroller(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function useSortableList(onReorder: (from: number, to: number) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const drag = useRef<DragState | null>(null);
  const raf = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const [slot, setSlot] = useState(0);

  const contentY = (d: DragState, clientY: number) => {
    if (!d.scroller) return clientY + window.scrollY;
    return clientY - d.scroller.getBoundingClientRect().top + d.scroller.scrollTop;
  };

  const update = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const scrollDelta = d.scroller ? d.scroller.scrollTop - d.startScrollTop : 0;
    setOffsetY(d.lastClientY - d.startClientY + scrollDelta);
    const y = contentY(d, d.lastClientY);
    let target = 0;
    d.mids.forEach((mid, j) => {
      if (j !== d.from && mid < y) target++;
    });
    d.target = target;
    setDropIdx(target);
  }, []);

  const stopAutoScroll = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const autoScroll = useCallback(() => {
    const d = drag.current;
    if (!d || !d.scroller) return;
    const rect = d.scroller.getBoundingClientRect();
    let step = 0;
    if (d.lastClientY < rect.top + EDGE_PX) {
      step = -Math.ceil(((rect.top + EDGE_PX - d.lastClientY) / EDGE_PX) * MAX_SCROLL_STEP);
    } else if (d.lastClientY > rect.bottom - EDGE_PX) {
      step = Math.ceil(((d.lastClientY - (rect.bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_STEP);
    }
    if (step !== 0) {
      const before = d.scroller.scrollTop;
      d.scroller.scrollTop = before + step;
      if (d.scroller.scrollTop !== before) update();
    }
    raf.current = requestAnimationFrame(autoScroll);
  }, [update]);

  const reset = useCallback(() => {
    stopAutoScroll();
    drag.current = null;
    setDragIdx(null);
    setDropIdx(null);
    setOffsetY(0);
  }, []);

  const finish = useCallback((commit: boolean) => {
    const d = drag.current;
    if (commit && d && d.target !== d.from) onReorder(d.from, d.target);
    reset();
  }, [onReorder, reset]);

  // Escape cancels a drag in progress.
  useEffect(() => {
    if (dragIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragIdx, finish]);

  useEffect(() => stopAutoScroll, []);

  const handleProps = (index: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return;
      e.preventDefault();
      e.stopPropagation();
      const row = rows.current[index];
      if (!row) return;
      const scroller = findScroller(row);
      const d: DragState = {
        from: index,
        pointerId: e.pointerId,
        startClientY: e.clientY,
        lastClientY: e.clientY,
        startScrollTop: scroller?.scrollTop ?? 0,
        scroller,
        mids: [],
        slot: 0,
        target: index,
      };
      d.mids = rows.current.map((el) => {
        if (!el) return Number.POSITIVE_INFINITY;
        const r = el.getBoundingClientRect();
        return contentY(d, r.top + r.height / 2);
      });
      const r = row.getBoundingClientRect();
      const below = rows.current[index + 1];
      const above = rows.current[index - 1];
      let gap = 0;
      if (below) gap = below.getBoundingClientRect().top - r.bottom;
      else if (above) gap = r.top - above.getBoundingClientRect().bottom;
      d.slot = r.height + Math.max(0, gap);
      drag.current = d;
      e.currentTarget.setPointerCapture(e.pointerId);
      setSlot(d.slot);
      setDragIdx(index);
      setDropIdx(index);
      setOffsetY(0);
      raf.current = requestAnimationFrame(autoScroll);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.lastClientY = e.clientY;
      update();
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (drag.current?.pointerId === e.pointerId) finish(true);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      if (drag.current?.pointerId === e.pointerId) finish(false);
    },
    style: { touchAction: 'none' } as React.CSSProperties,
  });

  const rowRef = (index: number) => (el: HTMLElement | null) => {
    rows.current[index] = el;
  };

  /** Transform for a row: the dragged one follows the pointer, the rows
   *  between its origin and the drop slot shift by one slot. */
  const rowStyle = (index: number): React.CSSProperties | undefined => {
    if (dragIdx === null || dropIdx === null) return undefined;
    if (index === dragIdx) {
      return { transform: `translateY(${offsetY}px)`, position: 'relative', zIndex: 10 };
    }
    let shift = 0;
    if (dragIdx < dropIdx && index > dragIdx && index <= dropIdx) shift = -slot;
    else if (dragIdx > dropIdx && index >= dropIdx && index < dragIdx) shift = slot;
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' };
  };

  return { handleProps, rowRef, rowStyle, dragIdx, dropIdx };
}
