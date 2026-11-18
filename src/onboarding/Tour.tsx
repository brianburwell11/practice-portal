import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withKeys } from '../components/ui/Kbd';
import { firstVisible, isTyping, useOnboardingStore } from './onboardingStore';

interface StepView {
  title: string;
  body: string;
}

/** A tour step: the first of its targets that's on the page, and what to say about it. */
interface Step {
  targets: { tour: string; view: (touch: boolean) => StepView }[];
}

/**
 * Six stops, in the order a first practice goes: load a song or setlist,
 * find the hard part, play and loop it, slow it down, hear your own part, and where help lives. A step
 * whose controls aren't on the page (a phone with the mixer closed, say) is
 * left out.
 */
const STEPS: Step[] = [
  {
    targets: [{
      tour: 'pick',
      view: () => ({
        title: 'Load a song or a setlist',
        body: 'Pick any song from this menu. To practice a set in order, load a setlist from the setlist menu instead.',
      }),
    }],
  },
  {
    targets: [{
      tour: 'waveform',
      view: (touch) => ({
        title: 'The whole song',
        body: touch
          ? 'Tap anywhere to jump there. To loop over a difficult passage, press and hold, then drag over it in the timeline.'
          : 'Click anywhere to jump there. To loop over a difficult passage, click and drag over it in the timeline.',
      }),
    }],
  },
  {
    targets: [{
      tour: 'transport',
      view: (touch) => ({
        title: 'Play, pause and loop',
        body: touch
          ? 'Hold play to stop and go back to the start. The loop button marks a loop: tap where it starts, then where it ends.'
          : '{Space} plays and pauses. The loop button marks a loop: click where it starts, then where it ends.',
      }),
    }],
  },
  {
    targets: [
      {
        tour: 'speed',
        view: () => ({
          title: 'Slow it down',
          body: 'Speed goes as low as 25% and the song stays in key, so a fast part can be learned slowly. Double-click a slider to reset it.',
        }),
      },
      {
        tour: 'mixer-toggle',
        view: () => ({
          title: 'Slow it down',
          body: 'This button opens speed, volume and the mixer. Speed goes as low as 25% and the song stays in key.',
        }),
      },
    ],
  },
  {
    targets: [{
      tour: 'mixer',
      view: (touch) => ({
        title: 'Hear your part',
        body: `Every stem has its own mixing controls. {S} solos a stem so you hear just it, {M} mutes it so you can play it yourself. ${
          touch ? 'Slide Vol' : 'Drag a fader'
        } to set its level.`,
      }),
    }],
  },
  {
    targets: [{
      tour: 'help',
      view: (touch) => ({
        title: 'Help is always here',
        body: touch
          ? 'Tap {?} any time to label every control, or to take this tour again.'
          : 'Press {?} any time to label every control, take this tour again, or see the keyboard shortcuts.',
      }),
    }],
  },
];

function resolve(step: Step, touch: boolean): { el: HTMLElement; view: StepView } | null {
  for (const t of step.targets) {
    const el = firstVisible(`[data-tour="${t.tour}"]`);
    if (el) return { el, view: t.view(touch) };
  }
  return null;
}

export function Tour() {
  const open = useOnboardingStore((s) => s.tourOpen);
  return open ? <TourRun /> : null;
}

/** Room around the spotlit control, and the card's distance from it and from the screen's edges. */
const PAD = 6;
const GAP = 12;
const EDGE = 16;

function TourRun() {
  const endTour = useOnboardingStore((s) => s.endTour);
  const touch = useMemo(() => window.matchMedia('(pointer: coarse)').matches, []);
  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  // The steps this layout has, fixed when the tour starts so the count holds still.
  const [steps] = useState(() => STEPS.filter((s) => resolve(s, touch)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 320, h: 170 });
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const step = steps[index];
  const target = step ? resolve(step, touch) : null;
  const last = index === steps.length - 1;

  const next = () => (last ? endTour() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // Nothing to show on this layout, or the step's control went away: move on.
  useEffect(() => {
    if (steps.length === 0) endTour();
    else if (step && !target) next();
  });

  // Bring the control into view, hand focus to the card, and keep the
  // spotlight on the control as the page scrolls and shifts.
  const el = target?.el;
  useEffect(() => {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    primary.current?.focus({ preventScroll: true });
    let frame = 0;
    let prev: DOMRect | null = null;
    const track = () => {
      const r = el.getBoundingClientRect();
      if (!prev || r.left !== prev.left || r.top !== prev.top || r.width !== prev.width || r.height !== prev.height) {
        prev = r;
        setRect(r);
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [el, reduceMotion]);

  // The card's size, for placing it (it renders once the spotlight has a place).
  const shown = !!(target && rect);
  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const measure = () => setCardSize({ w: node.offsetWidth, h: node.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      // Arrows step the tour only from the card (or nothing focused): a focused
      // pan knob, say, keeps them.
      const free = e.target === document.body || !!card.current?.contains(e.target as Node);
      if (e.key === 'Escape') endTour();
      else if (!free) return;
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!target || !rect) return null;

  // The card goes below the control, else above it, else at the bottom of the screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = rect.bottom + PAD + GAP;
  const above = rect.top - PAD - GAP - cardSize.h;
  const top = below + cardSize.h <= vh - EDGE ? below : above >= EDGE ? above : vh - EDGE - cardSize.h;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - cardSize.w / 2, EDGE), vw - EDGE - cardSize.w);
  const glide = 'transition-[left,top,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none';

  return (
    <>
      <div
        aria-hidden
        className={`fixed z-[96] pointer-events-none rounded-lg outline-2 outline-solid outline-blue-500 ${glide}`}
        style={{
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: '0 0 0 200vmax rgba(0, 0, 0, 0.55)',
        }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // Space and Enter belong to the card's buttons here, not to play/pause.
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
        }}
        className={`fixed z-[97] w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${glide}`}
        style={{ left, top }}
      >
        <h2 id={titleId} className="text-[0.9375rem] font-semibold text-gray-50 text-balance">{target.view.title}</h2>
        <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-gray-300 text-pretty">{withKeys(target.view.body)}</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-gray-500 tabular-nums" aria-label={`Step ${index + 1} of ${steps.length}`}>
            {index + 1} of {steps.length}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {!last && (
              <button
                onClick={endTour}
                className="rounded-lg px-2.5 py-1.5 text-sm text-gray-400 hover:text-gray-200 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                Skip tour
              </button>
            )}
            {index > 0 && (
              <button
                onClick={back}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-200 bg-gray-800 hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                Back
              </button>
            )}
            <button
              ref={primary}
              onClick={next}
              className="rounded-lg px-3.5 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
