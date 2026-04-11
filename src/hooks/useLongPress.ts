import { useRef, useCallback } from 'react';

const LONG_PRESS_MS = 500;

/**
 * Returns event handlers that distinguish tap from long-press.
 * On tap: calls `onTap` immediately (no delay).
 * On long-press (500ms hold): calls `onLongPress` and suppresses the tap.
 * Shift+click on desktop fires `onLongPress` immediately.
 * Prevents text selection and context menu on mobile during hold.
 */
export function useLongPress(onTap: () => void, onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); // prevent text selection during hold
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  }, [onLongPress]);

  const onPointerUp = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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
    onPointerCancel: onPointerUp,
    onClick,
    onContextMenu,
    style: { WebkitUserSelect: 'none' as const, userSelect: 'none' as const },
  };
}
