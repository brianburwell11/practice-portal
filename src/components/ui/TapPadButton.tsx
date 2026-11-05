import { useRef, useState } from 'react';

interface TapPadButtonProps {
  label: string;
  sublabel?: string;
  /** Tailwind classes for the resting background/text colors. */
  color?: string;
  onFire: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Big touch target for timing-critical taps (tapMap markers, lyric
 * stamps). Fires on pointer DOWN so the recorded time matches when the
 * finger lands, not when it lifts. Keyboard / assistive activation still
 * works through onClick, which only fires for synthetic clicks
 * (`detail === 0`) so a real tap never fires twice.
 */
export function TapPadButton({
  label,
  sublabel,
  color = 'bg-gray-700 text-gray-100',
  onFire,
  disabled,
  className = '',
}: TapPadButtonProps) {
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  const fire = () => {
    if (disabled) return;
    onFire();
    navigator.vibrate?.(10);
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 120);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        fire();
      }}
      onClick={(e) => {
        if (e.detail === 0) fire();
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'manipulation' }}
      className={`min-h-[72px] w-full rounded-xl px-2 py-2 flex flex-col items-center justify-center select-none transition-[filter,transform] duration-75 disabled:opacity-40 ${color} ${
        flash ? 'brightness-150 scale-[0.97]' : ''
      } ${className}`}
    >
      <span className="text-lg font-semibold leading-tight">{label}</span>
      {sublabel && (
        <span className="mt-0.5 max-w-full truncate text-xs opacity-75">{sublabel}</span>
      )}
    </button>
  );
}
