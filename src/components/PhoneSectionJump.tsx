import { useCallback, useEffect, useState, type RefObject } from 'react';

/** Below this many pixels, a section's top counts as already at the fold. */
const SLACK = 8;

/** Visible panels in the column, looking through `display: contents` wrappers. */
function sections(column: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const cs = getComputedStyle(child);
      if (cs.display === 'contents') walk(child);
      else if (cs.display !== 'none' && cs.position !== 'fixed' && cs.position !== 'absolute' && child.offsetHeight > 0) out.push(child);
    }
  };
  walk(column);
  return out;
}

/** Bottom edge of the pinned header and waveform: where a section lands. */
function foldY(scroller: HTMLElement): number {
  let y = scroller.getBoundingClientRect().top;
  scroller.querySelectorAll<HTMLElement>('[data-phone-pin]').forEach((el) => {
    y = Math.max(y, el.getBoundingClientRect().bottom);
  });
  return y;
}

/** The first panel whose top is still below the fold, if the page can scroll to it. */
function nextSection(scroller: HTMLElement, column: HTMLElement): HTMLElement | null {
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) return null;
  const fold = foldY(scroller);
  return sections(column).find((el) => el.getBoundingClientRect().top > fold + SLACK) ?? null;
}

/**
 * Phones: a round arrow at the bottom right that scrolls the next panel
 * (chords, lyrics, sheet music, mixer) up under the pinned waveform. Handy
 * when the lyrics fill the screen and a swipe on them drags the lyrics
 * instead of the page. Hidden once there's nowhere further to go.
 */
export function PhoneSectionJump({ scrollerRef, columnRef }: {
  scrollerRef: RefObject<HTMLElement | null>;
  columnRef: RefObject<HTMLElement | null>;
}) {
  const [show, setShow] = useState(false);

  const update = useCallback(() => {
    const scroller = scrollerRef.current;
    const column = columnRef.current;
    setShow(!!scroller && !!column && nextSection(scroller, column) !== null);
  }, [scrollerRef, columnRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const column = columnRef.current;
    if (!scroller || !column) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    schedule();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(column);
    const mo = new MutationObserver(schedule);
    mo.observe(column, { childList: true, subtree: false });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scrollerRef, columnRef, update]);

  const jump = () => {
    const scroller = scrollerRef.current;
    const column = columnRef.current;
    if (!scroller || !column) return;
    const target = nextSection(scroller, column);
    if (!target) return;
    scroller.scrollBy({ top: target.getBoundingClientRect().top - foldY(scroller), behavior: 'smooth' });
  };

  return (
    <button
      onClick={jump}
      aria-label="Scroll to the next section"
      title="Next section"
      data-help="Scroll to the next section"
      data-help-at="left"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 w-11 h-11 rounded-full flex items-center justify-center bg-blue-500 text-on-accent shadow-lg transition-[opacity,transform,filter] duration-200 hover:brightness-110 active:brightness-90 active:scale-90 active:duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        show ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
