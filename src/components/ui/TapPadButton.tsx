import { useEffect, useRef } from 'react';
import { useFlash } from '../../hooks/useFlash';

interface TapPadButtonProps {
  label: string;
  sublabel?: string;
  /** Keyboard shortcut shown after the label, e.g. "S" renders "(S)". */
  shortcut?: string;
  /**
   * Bump this when the action fires from the keyboard so the pad lights
   * up the same as a tap. Changes after mount trigger the flash.
   */
  pulse?: number;
  /** Tailwind classes for the resting background/text colors. */
  color?: string;
  /** `md` is a shorter pad for desktop layouts. */
  size?: 'lg' | 'md';
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
  shortcut,
  pulse,
  color = 'bg-gray-700 text-gray-100',
  size = 'lg',
  onFire,
  disabled,
  className = '',
}: TapPadButtonProps) {
  const { active, flash } = useFlash();

  // Flash when the parent reports a keyboard fire. Skip the first run so
  // mounting doesn't light the pad.
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === lastPulse.current) return;
    lastPulse.current = pulse;
    flash('pad');
  }, [pulse, flash]);

  const fire = () => {
    if (disabled) return;
    onFire();
    navigator.vibrate?.(10);
    flash('pad');
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
      className={`${size === 'md' ? 'min-h-[52px]' : 'min-h-[72px]'} w-full rounded-xl px-2 py-2 flex flex-col items-center justify-center select-none transition-[filter,transform] duration-75 disabled:opacity-40 ${color} ${
        active ? 'brightness-150 scale-[0.97]' : ''
      } ${className}`}
    >
      <span className={`${size === 'md' ? 'text-base' : 'text-lg'} font-semibold leading-tight`}>
        {label}
        {shortcut && <span className="ml-1 font-mono font-normal opacity-70">({shortcut})</span>}
      </span>
      {sublabel && (
        <span className="mt-0.5 max-w-full truncate text-xs opacity-75">{sublabel}</span>
      )}
    </button>
  );
}
