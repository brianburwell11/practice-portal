import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Kbd, withKeys } from '../components/ui/Kbd';
import { isShown, isTyping, useOnboardingStore } from './onboardingStore';
import { SHORTCUT_GROUPS } from './shortcuts';

interface Item {
  text: string;
  rect: DOMRect;
  /** Where the label prefers to sit (`data-help-at`): a side, or a corner off at 45°. */
  at?: Side;
}

type Corner = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
type Side = 'below' | 'above' | 'right' | 'left' | Corner;
const SIDES: readonly string[] = ['below', 'above', 'right', 'left', 'top-right', 'bottom-right', 'top-left', 'bottom-left'];

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Space between a control and its label, and the label's distance from the screen's edges. */
const GAP = 6;
/** How far a corner label sits off its corner, along each axis (so 45° out). */
const DIAG = 8;
/**
 * How much of a control a label may cover and still leave it plainly in
 * view: a sliver of a big area like the waveform, nothing that matters of a
 * button or slider.
 */
const COVER_LIMIT = 0.1;
const EDGE = 8;
/** Breathing room kept clear around every control and every placed label. */
const CLEAR = 3;
/** What counts as a control a label must not cover, labelled or not. */
const CONTROLS = 'button, a[href], input, select, textarea, [role="slider"], [role="button"], canvas, [data-help]';

/**
 * The ? panel: every visible control's label, right beside the control and
 * never on top of any control, plus a bar at the bottom with the keyboard shortcuts,
 * the tour and the Help guides. The page keeps working underneath: labels follow
 * scrolling, open panels and resizes.
 */
export function ControlLabels() {
  const open = useOnboardingStore((s) => s.labelsOpen);
  return open ? <LabelsOverlay /> : null;
}

function LabelsOverlay() {
  const hideLabels = useOnboardingStore((s) => s.hideLabels);
  const startTour = useOnboardingStore((s) => s.startTour);
  const shortcutsShown = useOnboardingStore((s) => s.shortcutsShown);
  const toggleShortcuts = useOnboardingStore((s) => s.toggleShortcuts);
  const [items, setItems] = useState<Item[]>([]);
  // Every visible control, labelled or not: labels keep off all of them.
  const [controls, setControls] = useState<Box[]>([]);
  // The label of the control under the pointer, shown in the accent color.
  const [hovered, setHovered] = useState<string | null>(null);
  const chips = useRef(new Map<string, HTMLDivElement>());
  const bar = useRef<HTMLDivElement>(null);
  // Re-run placement when the bar changes size (the shortcuts open, the text wraps).
  const [barSize, setBarSize] = useState('');

  // What's labelled right now: the first visible control for each text.
  const collect = useCallback(() => {
    // A view that covers the page (`data-help-scope`, like full screen sheet
    // music) has the labels to itself; the page under it isn't in view.
    const scopes = [...document.querySelectorAll<HTMLElement>('[data-help-scope]')].filter((el) => isShown(el));
    const root: ParentNode = scopes[scopes.length - 1] ?? document;
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('[data-help]')) {
      const text = el.dataset.help?.trim();
      if (!text || seen.has(text) || !isShown(el)) continue;
      seen.add(text);
      const at = el.dataset.helpAt;
      out.push({ text, rect: el.getBoundingClientRect(), at: at && SIDES.includes(at) ? (at as Side) : undefined });
    }
    setItems((prev) => (sameItems(prev, out) ? prev : out));
    const boxes: Box[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
      if (el.closest('[data-onboarding-ui]') || !isShown(el)) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    setControls((prev) => (sameBoxes(prev, boxes) ? prev : boxes));
  }, []);

  useEffect(() => {
    collect();
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(collect);
    };
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    window.addEventListener('resize', soon);
    // Panels open and close, songs load: look again now and then.
    const timer = window.setInterval(collect, 500);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e.target)) hideLabels();
    };
    window.addEventListener('keydown', onKey);
    const onMove = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-help]') : null;
      setHovered(el?.dataset.help?.trim() ?? null);
    };
    const onOut = () => setHovered(null);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onOut);
    const node = bar.current;
    const ro = node ? new ResizeObserver(() => setBarSize(`${node.offsetWidth}x${node.offsetHeight}`)) : null;
    if (node) ro?.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', soon, { capture: true });
      window.removeEventListener('resize', soon);
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onOut);
      ro?.disconnect();
    };
  }, [collect, hideLabels]);

  // Place each label right beside its control: below, above, right or left
  // (centered, then flush with either edge), a little further out only if
  // that's what it takes. A label leaves every control in view (it may
  // cover at most a sliver of one, see COVER_LIMIT), never covers another
  // label or the bar, and with nowhere like that close by it stays hidden.
  // A label with a preferred place (`data-help-at`) goes there, first. If a
  // label already placed is in the way it takes the nearest clear spot
  // further out on that side (for a corner, up or across, whichever is
  // nearer); labels further right claim their places first. Written straight to the
  // DOM (it depends on the labels' own sizes), before the browser paints.
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const floor = (bar.current?.getBoundingClientRect().top ?? window.innerHeight) - EDGE;
    const labels: Box[] = [];

    const order = [...items].sort((a, b) =>
      Number(!!b.at) - Number(!!a.at)
      || (a.at && b.at ? b.rect.right - a.rect.right : a.rect.top - b.rect.top || a.rect.left - b.rect.left));
    for (const { text, rect, at } of order) {
      const chip = chips.current.get(text);
      if (!chip) continue;
      const w = chip.offsetWidth;
      const h = chip.offsetHeight;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Controls that hold this one (a strip around its fader, say) don't count.
      const others = controls.filter((c) => !(c.l <= rect.left && c.t <= rect.top && c.r >= rect.right && c.b >= rect.bottom));
      const hides = (box: Box) => others.some((o) => overlapArea(box, o) > COVER_LIMIT * (o.r - o.l) * (o.b - o.t));
      const across = [cx - w / 2, rect.left, rect.right - w];
      const around = (d: number): { side: Side; l: number; t: number }[] => [
        ...across.map((l) => ({ side: 'below' as const, l, t: rect.bottom + d })),
        ...across.map((l) => ({ side: 'above' as const, l, t: rect.top - d - h })),
        { side: 'right', l: rect.right + d, t: cy - h / 2 },
        { side: 'left', l: rect.left - d - w, t: cy - h / 2 },
      ];
      // A preferred place comes first: a side (centered on the control), or a
      // corner, the label's nearest corner 45° off the control's. To clear a
      // placed label it moves further out: along its side, or for a corner
      // up/down and across in any mix, the nearest clear spot winning.
      type Spot = { side: Side; l: number; t: number };
      const base: Record<Side, Spot & { dx: number; dy: number }> = {
        below: { side: 'below', l: cx - w / 2, t: rect.bottom + GAP, dx: 0, dy: 1 },
        above: { side: 'above', l: cx - w / 2, t: rect.top - GAP - h, dx: 0, dy: -1 },
        right: { side: 'right', l: rect.right + GAP, t: cy - h / 2, dx: 1, dy: 0 },
        left: { side: 'left', l: rect.left - GAP - w, t: cy - h / 2, dx: -1, dy: 0 },
        'top-right': { side: 'top-right', l: rect.right + DIAG, t: rect.top - DIAG - h, dx: 1, dy: -1 },
        'bottom-right': { side: 'bottom-right', l: rect.right + DIAG, t: rect.bottom + DIAG, dx: 1, dy: 1 },
        'top-left': { side: 'top-left', l: rect.left - DIAG - w, t: rect.top - DIAG - h, dx: -1, dy: -1 },
        'bottom-left': { side: 'bottom-left', l: rect.left - DIAG - w, t: rect.bottom + DIAG, dx: -1, dy: 1 },
      };
      const slides: Spot[] = [];
      if (at) {
        const b = base[at];
        const steps = Array.from({ length: 13 }, (_, i) => i * 5);
        for (const x of b.dx ? steps : [0]) {
          for (const y of b.dy ? steps : [0]) slides.push({ side: at, l: b.l + b.dx * x, t: b.t + b.dy * y });
        }
        slides.sort((p, q) => Math.hypot(p.l - b.l, p.t - b.t) - Math.hypot(q.l - b.l, q.t - b.t));
      }
      const onScreen = (box: Box) => box.l >= EDGE && box.r <= vw - EDGE && box.t >= EDGE && box.b <= floor;
      const clear = slides.find(({ l, t }) => {
        const box = { l, t, r: l + w, b: t + h };
        return onScreen(box) && !labels.some((o) => overlaps(box, o));
      });
      const spot: Spot | undefined = clear ?? slides.find(({ l, t }) => onScreen({ l, t, r: l + w, b: t + h }))
        ?? [GAP, GAP + 10].flatMap(around).find(({ l, t }) => {
          const box = { l, t, r: l + w, b: t + h };
          return onScreen(box) && !hides(grow(box, CLEAR)) && !labels.some((o) => overlaps(box, o));
        });
      if (!spot) {
        chip.style.visibility = 'hidden';
        continue;
      }
      chip.style.visibility = 'visible';
      chip.style.left = `${spot.l}px`;
      chip.style.top = `${spot.t}px`;
      pointCaret(chip, spot.side, rect, spot.l, spot.t, w, h);
      labels.push(grow({ l: spot.l, t: spot.t, r: spot.l + w, b: spot.t + h }, CLEAR));
    }
  }, [items, controls, shortcutsShown, barSize]);

  return (
    <div data-onboarding-ui>
      {items.map(({ text, rect }) => (
        <div
          key={`ring-${text}`}
          aria-hidden
          className={`fixed z-[94] pointer-events-none rounded-md outline outline-offset-2 transition-[outline-color] duration-150 ${
            hovered === text ? 'outline-2 outline-blue-500' : 'outline-[1.5px] outline-blue-500/70'
          }`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
      {items.map(({ text }) => {
        const on = hovered === text;
        return (
        <div
          key={text}
          aria-hidden
          ref={(el) => {
            if (el) chips.current.set(text, el);
            else chips.current.delete(text);
          }}
          className={`fixed left-0 top-0 invisible pointer-events-none max-w-[12rem] rounded-md border px-1.5 py-0.5 text-[11px] leading-snug text-center text-pretty shadow-[0_4px_12px_rgba(0,0,0,0.35)] transition-colors duration-150 motion-safe:animate-[label-in_160ms_cubic-bezier(0.16,1,0.3,1)] ${
            on ? 'z-[95] border-blue-600 bg-blue-600 text-accent-ink' : 'z-[94] border-gray-600 bg-gray-900 text-gray-100'
          }`}
        >
          <span
            data-caret
            aria-hidden
            className={`absolute size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-solid transition-colors duration-150 ${
              on ? 'border-blue-600 bg-blue-600' : 'border-gray-600 bg-gray-900'
            }`}
          />
          <span
            data-tick
            aria-hidden
            className={`absolute h-[1.5px] origin-left transition-colors duration-150 ${on ? 'bg-blue-600' : 'bg-gray-600'}`}
            style={{ display: 'none' }}
          />
          <span className="relative">{withKeys(text)}</span>
        </div>
        );
      })}

      <div className="fixed inset-x-0 bottom-0 z-[95] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div
          ref={bar}
          role="region"
          aria-label="Help"
          className="pointer-events-auto w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {shortcutsShown && <ShortcutList />}
          <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-gray-300 text-pretty">
              Each label says what its control does. Everything still works while they’re up.
            </p>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button onClick={startTour} className={SECONDARY}>
                Take the tour
              </button>
              <button
                onClick={toggleShortcuts}
                aria-expanded={shortcutsShown}
                aria-controls="help-shortcuts"
                className={`${SECONDARY} inline-flex items-center gap-1.5`}
              >
                Shortcuts
                <svg
                  className={`size-3.5 transition-transform duration-200 motion-reduce:transition-none ${shortcutsShown ? '' : 'rotate-180'}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                >
                  <path d="m6 15 6-6 6 6" />
                </svg>
              </button>
              <a href="/help" target="_blank" rel="noopener" className={`${SECONDARY} inline-flex items-center`}>
                Help guides
              </a>
              <button
                onClick={hideLabels}
                autoFocus
                className="rounded-lg px-4 py-2 min-h-9 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SECONDARY =
  'rounded-lg px-3 py-2 min-h-9 text-sm text-gray-200 bg-gray-800 hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-500';

/** The player's keyboard shortcuts, grouped, opened out above the bar's buttons. */
function ShortcutList() {
  return (
    <div id="help-shortcuts" className="border-b border-gray-700 px-4 pt-3 pb-3 max-h-[50vh] overflow-y-auto">
      <h2 className="text-sm font-semibold text-gray-100">Keyboard shortcuts</h2>
      <div className="mt-1 gap-x-8 sm:columns-2">
        {SHORTCUT_GROUPS.map(({ title, shortcuts }) => (
          <section key={title} className="break-inside-avoid pt-3">
            <h3 className="mb-1.5 text-xs font-semibold text-gray-400">{title}</h3>
            <dl className="space-y-1.5">
              {shortcuts.map(({ action, keys }) => (
                <div key={action} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-gray-300">{action}</dt>
                  <dd className="shrink-0 text-right text-gray-500">
                    {keys.map((combo, i) => (
                      <Fragment key={i}>
                        {i > 0 && <span className="mx-1 text-xs">or</span>}
                        {combo.map((k, j) => (
                          <Fragment key={j}>
                            {j > 0 && <span className="mx-0.5 text-xs">+</span>}
                            <Kbd>{k}</Kbd>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
        <a href="/help/keyboard-shortcuts" target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
          Every shortcut, including the editors’
        </a>
        <span aria-hidden className="text-gray-600">·</span>
        <a href="mailto:support@practiceportal.app?subject=Practice%20Portal%20Support" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
          Contact support
        </a>
      </p>
    </div>
  );
}

function grow(r: DOMRect | Box, by: number): Box {
  const box = 'l' in r ? r : { l: r.left, t: r.top, r: r.right, b: r.bottom };
  return { l: box.l - by, t: box.t - by, r: box.r + by, b: box.b + by };
}

function overlaps(a: Box, b: Box): boolean {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

function overlapArea(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
}

function sameBoxes(a: Box[], b: Box[]): boolean {
  return a.length === b.length && a.every((x, i) => x.l === b[i].l && x.t === b[i].t && x.r === b[i].r && x.b === b[i].b);
}

/**
 * Aim the label at its control. Beside it: a caret on the label's edge facing
 * the control, at the control's center (kept inside the label's corners).
 * Off a corner: a short line from the label's nearest corner to the
 * control's. `l` and `t` are the label's position.
 */
function pointCaret(chip: HTMLElement, side: Side, rect: DOMRect, l: number, t: number, w: number, h: number) {
  const caret = chip.querySelector<HTMLElement>('[data-caret]');
  const tick = chip.querySelector<HTMLElement>('[data-tick]');
  if (!caret || !tick) return;
  if (side === 'top-right' || side === 'bottom-right' || side === 'top-left' || side === 'bottom-left') {
    caret.style.display = 'none';
    tick.style.display = '';
    // The label's corner nearest the control, and the control's corner it points at (label coordinates).
    const [fx, fy, tx, ty] = {
      'top-right': [0, h, rect.right - l, rect.top - t],
      'bottom-right': [0, 0, rect.right - l, rect.bottom - t],
      'top-left': [w, h, rect.left - l, rect.top - t],
      'bottom-left': [w, 0, rect.left - l, rect.bottom - t],
    }[side];
    tick.style.left = `${fx}px`;
    tick.style.top = `${fy}px`;
    tick.style.width = `${Math.hypot(tx - fx, ty - fy)}px`;
    tick.style.transform = `rotate(${Math.atan2(ty - fy, tx - fx)}rad)`;
    return;
  }
  tick.style.display = 'none';
  caret.style.display = '';
  const x = rect.left + rect.width / 2 - l;
  const y = rect.top + rect.height / 2 - t;
  const clampX = Math.min(Math.max(x, 10), w - 10);
  const clampY = Math.min(Math.max(y, 8), h - 8);
  const [left, top] = {
    below: [clampX, 0],
    above: [clampX, h],
    right: [0, clampY],
    left: [w, clampY],
  }[side];
  caret.style.left = `${left}px`;
  caret.style.top = `${top}px`;
  // Rotated 45°, the two bordered sides form the point facing the control.
  const edges = { below: ['Left', 'Top'], above: ['Right', 'Bottom'], right: ['Left', 'Bottom'], left: ['Right', 'Top'] }[side];
  for (const e of ['Left', 'Top', 'Right', 'Bottom']) {
    caret.style.setProperty(`border-${e.toLowerCase()}-width`, edges.includes(e) ? '1px' : '0');
  }
}

function sameItems(a: Item[], b: Item[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.text === y.text && x.rect.left === y.rect.left && x.rect.top === y.rect.top
      && x.rect.width === y.rect.width && x.rect.height === y.rect.height;
  });
}
