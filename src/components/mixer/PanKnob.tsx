import { useEffect, useRef } from 'react';

interface PanKnobProps {
  /** -1 (left) to 1 (right). */
  value: number;
  onChange: (value: number) => void;
  color: string;
  label: string;
  /** Double-click (and Space/Enter) target: the stem's default pan. */
  resetValue: number;
}

/** Pixels of vertical drag for the full left-to-right sweep. */
const FULL_SWEEP_PX = 150;
/** The knob turns through 270°, from 7:30 to 4:30. */
const SWEEP_DEG = 135;
const SIZE = 28;
const C = SIZE / 2;
const R = 11;

const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 100) / 100));

function pointAt(deg: number, r: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

/** Arc from 12 o'clock to `deg` (negative turns left). */
function arcPath(deg: number): string {
  const [x0, y0] = pointAt(0, R);
  const [x1, y1] = pointAt(deg, R);
  return `M ${x0} ${y0} A ${R} ${R} 0 0 ${deg >= 0 ? 1 : 0} ${x1} ${y1}`;
}

function valueText(v: number): string {
  if (v === 0) return 'Center';
  return `${v < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(v) * 100)}`;
}

/**
 * Logic-style pan knob. Drag up/down to turn (Shift for fine), scroll,
 * arrow keys, or double-click to go back to the default pan.
 */
export function PanKnob({ value, onChange, color, label, resetValue }: PanKnobProps) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });

  // Native, non-passive, so scrolling over the knob turns it instead of
  // also scrolling the mixer.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { value: v, onChange: set } = latest.current;
      const next = clamp(v + (e.deltaY < 0 ? 0.02 : -0.02));
      if (next !== v) set(next);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
  const deg = value * SWEEP_DEG;
  const [tipX, tipY] = pointAt(deg, R - 3.5);
  const [startX, startY] = pointAt(-SWEEP_DEG, R);
  const [endX, endY] = pointAt(SWEEP_DEG, R);

  return (
    <div
      ref={el}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-valuetext={valueText(value)}
      title={`${valueText(value)}. Drag up or down, double-click to reset.`}
      className="cursor-ns-resize rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const scale = e.shiftKey ? 4 : 1;
        const delta = ((drag.current.y - e.clientY) / FULL_SWEEP_PX) * 2 / scale;
        const next = clamp(drag.current.value + delta);
        if (next !== value) onChange(next);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => onChange(resetValue)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        let next: number | null = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step;
        else if (e.key === 'Home') next = -1;
        else if (e.key === 'End') next = 1;
        else if (e.key === ' ' || e.key === 'Enter') next = resetValue;
        if (next === null) return;
        e.preventDefault();
        onChange(clamp(next));
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
        {/* Track: the full 270° sweep */}
        <path
          d={`M ${startX} ${startY} A ${R} ${R} 0 1 1 ${endX} ${endY}`}
          fill="none"
          stroke="#4b5563"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {value !== 0 && (
          <path d={arcPath(deg)} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        )}
        <circle cx={C} cy={C} r={R - 2.5} fill="#374151" stroke="#1f2937" />
        <line x1={C} y1={C} x2={tipX} y2={tipY} stroke="#e5e7eb" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </div>
  );
}
