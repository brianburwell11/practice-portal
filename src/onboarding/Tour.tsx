import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withKeys } from '../components/ui/Kbd';
import { useSongStore } from '../store/songStore';
import { firstVisible, isShown, isTyping, useOnboardingStore } from './onboardingStore';

interface StepView {
  title: string;
  body: string;
  /** A short list under the body: what each of several buttons is for. */
  points?: { name: string; what: string }[];
}

/**
 * A tour step: the first of its targets that's on the page, and what to say
 * about it. A target is every visible element tagged `data-tour="<tour>"`,
 * spotlit together.
 */
interface Step {
  targets: { tour: string; view: (touch: boolean) => StepView }[];
}

/**
 * The stops, in the order a first practice goes: load a song or setlist,
 * find the hard part, play, loop it, (on phones) the other buttons' tools,
 * slow it down, hear your own part, and where help lives. A step whose
 * controls aren't on the page (the phone buttons on a computer, the mixer
 * closed on a phone) is left out.
 */
const STEPS: Step[] = [
  {
    targets: [{
      tour: 'pick',
      // A link that opened a song has already done the loading: say how to switch instead.
      view: () => (useSongStore.getState().selectedSong
        ? {
          title: 'Switch songs or setlists',
          body: 'Your song is loaded and ready. Pick another one from this menu, or load a setlist from the setlist menu to practice a set in order.',
        }
        : {
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
      tour: 'play',
      view: (touch) => ({
        title: 'Play and pause',
        body: touch
          ? 'Tap to play or pause. Press and hold to stop and go back to the start.'
          : 'Click to play or pause, or press {Space}. The square button beside it stops and goes back to the start.',
      }),
    }],
  },
  {
    targets: [{
      tour: 'loop',
      view: (touch) => ({
        title: 'Loop a passage',
        body: touch
          ? 'Tap where the loop should start, then tap again where it should end. Tap to turn it off and on, press and hold to clear it.'
          : 'Click where the loop should start, then click again where it should end. Click to turn it off and on, {Shift} + click to clear it.',
      }),
    }],
  },
  {
    targets: [{
      tour: 'phone-tools',
      view: () => {
        // Chords, lyrics and sheet music buttons show only when the song has them.
        const has = (label: string) => !!firstVisible(`[data-tour="phone-tools"][aria-label="${label}"]`);
        const points = [
          { name: 'Bookmark', what: 'jump to a timestamp, measure or section' },
          has('Chords') && { name: 'Chords', what: 'show or hide the chords' },
          has('Lyrics') && { name: 'Lyrics', what: 'show or hide the lyrics' },
          has('Sheet music') && { name: 'Sheet music', what: 'open it full screen' },
          { name: 'Sliders', what: 'the mixer, volume and playback speed' },
        ].filter((p): p is { name: string; what: string } => !!p);
        return { title: 'More tools', body: 'These buttons show and hide the rest:', points };
      },
    }],
  },
  {
    targets: [{
      tour: 'speed',
      view: () => ({
        title: 'Slow it down',
        body: 'Speed goes as low as 25% and the song stays in key, so a fast part can be learned slowly. Double-click a slider to reset it.',
      }),
    }],
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
          ? 'Tap {?} any time to take this tour again or open the Help guides.'
          : 'Press {?} any time to label every control, take this tour again, or see the keyboard shortcuts.',
      }),
    }],
  },
];

function resolve(step: Step, touch: boolean): { els: HTMLElement[]; view: StepView } | null {
  for (const t of step.targets) {
    const els = [...document.querySelectorAll<HTMLElement>(`[data-tour="${t.tour}"]`)].filter((el) => isShown(el, false));
    if (els.length) return { els, view: t.view(touch) };
  }
  return null;
}

/** The box around all of `els`. */
function unionRect(els: HTMLElement[]): DOMRect {
  const rs = els.map((el) => el.getBoundingClientRect());
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  const r = Math.max(...rs.map((x) => x.right));
  const b = Math.max(...rs.map((x) => x.bottom));
  return new DOMRect(l, t, r - l, b - t);
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

  // Bring the controls into view, hand focus to the card, and keep the
  // spotlight on them as the page scrolls and shifts.
  const els = target?.els;
  const first = els?.[0];
  useEffect(() => {
    if (!first || !els) return;
    first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    primary.current?.focus({ preventScroll: true });
    let frame = 0;
    let prev: DOMRect | null = null;
    const track = () => {
      const r = unionRect(els);
      if (!prev || r.left !== prev.left || r.top !== prev.top || r.width !== prev.width || r.height !== prev.height) {
        prev = r;
        setRect(r);
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
    // `els` is a new array each render; the step's first element stands for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, index, reduceMotion]);

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
        {target.view.points && (
          <ul className="mt-2 space-y-1 text-sm leading-snug text-gray-300">
            {target.view.points.map((p) => (
              <li key={p.name}>
                <span className="font-medium text-gray-100">{p.name}</span>: {p.what}
              </li>
            ))}
          </ul>
        )}
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
