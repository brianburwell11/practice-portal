import { useEffect, useState } from 'react';
import practicePortalMark from '../../assets/practice-portal-mark-large.png';
import { fadeInScreen } from './screenFade';

// When the loader on screen first appeared. A page load hands off between
// loaders (code, then the band, then the song screen's code); each picks up
// the pulse where the last left off instead of fading in again.
let shownSince: number | null = null;
let mounted = 0;
/** The mark's wait before it shows, as in `--animate-loader`. */
const LOADER_WAIT_MS = 250;

/**
 * A whole page that isn't ready yet: the Practice Portal mark, slowly pulsing.
 * It waits a moment before appearing, so a fast load never flashes it.
 * `caption` says what's on its way, in a line under the mark that arrives
 * with it and holds still while the mark breathes.
 */
export function PageLoader({ label = 'Loading', caption }: { label?: string; caption?: string }) {
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
        if (mounted !== 0 || shownSince === null) return;
        // The page is in. If the mark was on screen (past its wait), bring
        // the page up from the background instead of cutting to it.
        if (performance.now() - shownSince > LOADER_WAIT_MS) fadeInScreen();
        shownSince = null;
      });
    };
  }, []);

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center gap-5 p-8" role="status">
      <img
        src={practicePortalMark}
        alt=""
        className="h-20 sm:h-28 w-auto animate-loader"
        // Matches the delays in `--animate-loader`, less the time already shown.
        style={{ animationDelay: `${LOADER_WAIT_MS - elapsed}ms, ${LOADER_WAIT_MS + 600 - elapsed}ms` }}
      />
      {caption ? (
        <p
          className="text-sm text-gray-400 text-center animate-loader-caption"
          style={{ animationDelay: `${LOADER_WAIT_MS - elapsed}ms` }}
        >
          {caption}
        </p>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}

/** A grey stand-in for content on its way. Size and shape it with `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-gray-700/60 rounded motion-safe:animate-pulse ${className}`} />;
}
