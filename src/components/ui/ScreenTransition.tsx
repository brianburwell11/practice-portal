import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { fadeInScreen, setScreenElement } from './screenFade';

/**
 * Brings each new screen in when the route changes: the band picker, a band,
 * the admin pages, account, help. Song changes don't count; the song list
 * moves the URL itself, outside the router.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);

  useLayoutEffect(() => {
    setScreenElement(ref.current);
    return () => setScreenElement(null);
  }, []);

  // Layout effect: starts before the new screen is first painted.
  useLayoutEffect(() => {
    if (shown.current !== null && shown.current !== pathname) fadeInScreen();
    shown.current = pathname;
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
