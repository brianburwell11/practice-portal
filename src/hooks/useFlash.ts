import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Brief "pressed" highlight for buttons that can also be fired from the
 * keyboard, so a shortcut visibly activates its button. `flash(id)` lights
 * up the button with that id for `ms`; `active` is the lit id (or null).
 */
export function useFlash(ms = 120) {
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = useCallback((id: string) => {
    setActive(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(null), ms);
  }, [ms]);

  return { active, flash };
}
