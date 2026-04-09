import { useRef, useCallback } from 'react';
import * as Slider from '@radix-ui/react-slider';

interface TouchSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onDoubleClick?: () => void;
  label?: string;
  className?: string;
  accentColor?: string;
}

const LOCK_THRESHOLD = 8;

export function TouchSlider({
  min,
  max,
  step,
  value,
  onChange,
  onDoubleClick,
  label,
  className = '',
  accentColor = '#3b82f6',
}: TouchSliderProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lockedRef = useRef<'horizontal' | 'vertical' | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    lockedRef.current = null;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current || lockedRef.current) return;

    const dx = Math.abs(e.clientX - startRef.current.x);
    const dy = Math.abs(e.clientY - startRef.current.y);

    if (dx < LOCK_THRESHOLD && dy < LOCK_THRESHOLD) return;

    if (dy > dx) {
      lockedRef.current = 'vertical';
      if (rootRef.current) {
        rootRef.current.style.touchAction = 'auto';
      }
      const target = e.currentTarget as HTMLElement;
      try { target.releasePointerCapture(e.pointerId); } catch {}
    } else {
      lockedRef.current = 'horizontal';
      if (rootRef.current) {
        rootRef.current.style.touchAction = 'none';
      }
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    startRef.current = null;
    lockedRef.current = null;
    if (rootRef.current) {
      rootRef.current.style.touchAction = '';
    }
  }, []);

  return (
    <Slider.Root
      ref={rootRef}
      className={`relative flex items-center select-none touch-none h-5 md:h-4 ${className}`}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      onDoubleClick={onDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label={label}
    >
      <Slider.Track className="relative grow rounded-full h-2 md:h-1.5 bg-gray-600">
        <Slider.Range
          className="absolute rounded-full h-full"
          style={{ backgroundColor: accentColor }}
        />
      </Slider.Track>
      <Slider.Thumb
        className="block w-5 h-5 md:w-4 md:h-4 rounded-full bg-white shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </Slider.Root>
  );
}
