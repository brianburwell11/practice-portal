import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, updating live (resize, rotation). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A tablet: a touch screen wide enough for the desktop layout. Matches the
 *  CSS `tab:` variant, for code that sizes things itself. */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px) and (pointer: coarse)');
}
