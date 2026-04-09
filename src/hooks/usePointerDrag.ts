import { useRef, useCallback } from 'react';

interface PointerDragHandlers {
  onDragStart?: (x: number, y: number) => void;
  onDragMove?: (x: number, y: number) => void;
  onDragEnd?: (x: number, y: number) => void;
  onTap?: (x: number, y: number) => void;
}

const DRAG_THRESHOLD = 4;

export function usePointerDrag(handlers: PointerDragHandlers) {
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      startPos.current = { x, y };
      didDrag.current = false;
      dragging.current = true;

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      handlers.onDragStart?.(x, y);
    },
    [handlers],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (!didDrag.current) {
        const dx = x - startPos.current.x;
        const dy = y - startPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        didDrag.current = true;
      }

      handlers.onDragMove?.(x, y);
    },
    [handlers],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (didDrag.current) {
        handlers.onDragEnd?.(x, y);
      } else {
        handlers.onTap?.(x, y);
      }
    },
    [handlers],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
