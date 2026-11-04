import { useRef, useCallback } from 'react';

const LONG_PRESS_MS = 500;

/**
 * Returns event handlers that distinguish tap from long-press.
 * On tap: calls `onTap` immediately (no delay).
 * On long-press (held 500 ms): calls `onLongPress` when released, and
 * suppresses the tap. Shift+click on desktop fires `onLongPress` immediately.
 * Prevents text selection and context menu on mobile during hold.
 *
 * The hold is measured from the events' own timestamps, not with a timer.
 * A timer started on press fires on time even when the page is busy (laying
 * out a score after a rotation, say) and the release is still waiting in the
 * queue, which turned quick taps on play/pause into long presses (stop).
 */
export function useLongPress(onTap: () => void, onLongPress: () => void) {
  const downAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); // prevent text selection during hold
    firedRef.current = false;
    downAtRef.current = e.timeStamp;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const downAt = downAtRef.current;
    downAtRef.current = null;
    if (downAt !== null && e.timeStamp - downAt >= LONG_PRESS_MS) {
      firedRef.current = true;
      onLongPress();
    }
  }, [onLongPress]);

  const onPointerCancel = useCallback(() => {
    downAtRef.current = null;
  }, []);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    if (e.shiftKey) {
      onLongPress();
      return;
    }
    onTap();
  }, [onTap, onLongPress]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // block mobile long-press context menu
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onClick,
    onContextMenu,
    style: { WebkitUserSelect: 'none' as const, userSelect: 'none' as const },
  };
}
