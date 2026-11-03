import { useEffect, useState } from 'react';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';

// When the loader on screen first appeared. A page load hands off between
// loaders (code, then the band, then the song screen's code); each picks up
// the pulse where the last left off instead of fading in again.
let shownSince: number | null = null;
let mounted = 0;

/**
 * A whole page that isn't ready yet: the Practice Portal mark, slowly pulsing.
 * It waits a moment before appearing, so a fast load never flashes it.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  const [elapsed] = useState(() => {
    if (shownSince === null) shownSince = performance.now();
    return performance.now() - shownSince;
  });

  useEffect(() => {
    mounted++;
    return () => {
      mounted--;
      // Wait a frame: the next loader in a handoff mounts right after.
      requestAnimationFrame(() => {
        if (mounted === 0) shownSince = null;
      });
    };
  }, []);

  return (
    <div className="min-h-screen bg-page flex items-center justify-center" role="status">
      <img
        src={practicePortalMark}
        alt=""
        className="h-20 sm:h-28 w-auto animate-loader"
        // Matches the delays in `--animate-loader`, less the time already shown.
        style={{ animationDelay: `${250 - elapsed}ms, ${850 - elapsed}ms` }}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** A grey stand-in for content on its way. Size and shape it with `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-gray-700/60 rounded motion-safe:animate-pulse ${className}`} />;
}
