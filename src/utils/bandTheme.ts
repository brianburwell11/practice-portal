/**
 * Band page legibility.
 *
 * A band picks its own background and text colors, but the page's UI is
 * written with Tailwind's gray scale (`text-gray-400`, `bg-gray-800`, ...)
 * tuned for the stock dark navy page. Tailwind v4 compiles those classes to
 * `var(--color-gray-400)` and friends, so redefining the scale on the band
 * page root makes every existing class follow the band's colors.
 *
 * The scale runs from the band's text color ("ink", gray-50) down to its
 * background (gray-950), keeping the stock theme's spacing, then each step
 * that carries text is pushed toward the ink until it reaches a minimum WCAG
 * contrast against the background. A few accent hues used as text (amber,
 * blue, red...) get the same floor.
 */
import type { BandColors } from '../audio/types';

type RGB = [number, number, number]; // sRGB, 0..1
type Lab = [number, number, number]; // OKLab

/** The stock page color (`--color-page` in index.css). */
export const DEFAULT_PAGE_BG = '#080e22';
/** The stock page text color (App's fallback for `--band-text`). */
export const DEFAULT_PAGE_TEXT = '#f3f4f6';

// ---------- parsing / conversion ----------

export function parseHex(input: string | undefined | null): RGB | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16) / 255);
    return [r, g, b];
  }
  return null;
}

export function toHex(rgb: RGB): string {
  return (
    '#' +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: RGB): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab to sRGB, pulling chroma in until the color fits the sRGB gamut. */
function oklabToRgb([L, a, b]: Lab): RGB {
  const Lc = Math.min(1, Math.max(0, L));
  for (let k = 1; k >= 0; k -= 0.05) {
    const lin = oklabToLinear([Lc, a * k, b * k]);
    if (lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4)) {
      return lin.map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as RGB;
    }
  }
  return oklabToLinear([Lc, 0, 0]).map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as RGB;
}

/** Parse `oklch(L% C H)` (Tailwind's palette format). */
function parseOklch(s: string): Lab {
  const m = /oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/.exec(s);
  if (!m) throw new Error(`bad oklch: ${s}`);
  const L = parseFloat(m[1]) / 100;
  const C = parseFloat(m[2]);
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

// ---------- contrast ----------

export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast between two hex colors; 1 if either can't be parsed. */
export function contrastHex(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  return ra && rb ? contrastRatio(ra, rb) : 1;
}

/** Searches aim this far above a floor to survive rounding to 8-bit hex. */
const HEADROOM = 0.08;

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [1, 1, 1];

/** Black or white, whichever stands out more on `bg`. */
function extreme(bg: RGB): RGB {
  return contrastRatio(BLACK, bg) >= contrastRatio(WHITE, bg) ? BLACK : WHITE;
}

/**
 * Move `color`'s lightness toward black or white (whichever `bg` favors),
 * keeping its hue, just far enough to reach `min` contrast on `bg`. If even
 * the extreme can't get there, returns the extreme.
 */
function liftLightness(color: Lab, bg: RGB, floor: number): RGB {
  // A little headroom so rounding to hex doesn't land just under the floor.
  const min = floor + HEADROOM;
  const start = oklabToRgb(color);
  if (contrastRatio(start, bg) >= min) return start;
  const targetL = extreme(bg) === WHITE ? 1 : 0;
  const at = (t: number): RGB =>
    oklabToRgb([color[0] + (targetL - color[0]) * t, color[1] * (1 - t * 0.3), color[2] * (1 - t * 0.3)]);
  if (contrastRatio(at(1), bg) < min) return extreme(bg);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(at(mid), bg) >= min) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

// ---------- the theme ----------

/** Contrast the band's text color must reach on its background. */
export const INK_MIN = 7;
/** Contrast an adjusted text color aims for. */
const ADJUSTED_INK_TARGET = 12;

/** The band's text color, adjusted if needed to read clearly on `bg`. */
export function resolveInk(bg: RGB, text: RGB | null): RGB {
  if (text && contrastRatio(text, bg) >= INK_MIN) return text;
  if (!text) return extreme(bg);
  // Once we're adjusting anyway, go well past the bare minimum so the
  // scale below the ink has room for active, upcoming and past text.
  const best = contrastRatio(extreme(bg), bg);
  const target = Math.max(INK_MIN, Math.min(ADJUSTED_INK_TARGET, best * 0.9));
  return liftLightness(rgbToOklab(text), bg, target);
}

export const GRAY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
type GrayStep = (typeof GRAY_STEPS)[number];

/**
 * Where each step sits between background (0) and ink (1), measured from
 * Tailwind's grays on the stock navy page so the default look carries over.
 * 950 sits just past the background, like the stock theme's darkest gray.
 */
const STEP_POSITION: Record<GrayStep, number> = {
  50: 1,
  100: 0.978,
  200: 0.93,
  300: 0.861,
  400: 0.659,
  500: 0.468,
  600: 0.339,
  700: 0.249,
  800: 0.132,
  900: 0.049,
  950: -0.049,
};

/**
 * Minimum contrast against the background for each step:
 * 50 to 300 are active text (current lyric, current chord),
 * 400 and 500 are upcoming text, labels and icons,
 * 600 is past or de-emphasised text,
 * 700 and 800 are borders and button surfaces, just enough to show.
 * Each floor is capped by what the ink itself reaches, so a mid-gray band
 * still gets the most legible scale possible.
 */
const STEP_FLOOR: Partial<Record<GrayStep, number>> = {
  50: 7,
  100: 7,
  200: 7,
  300: 7,
  400: 4.5,
  500: 4.5,
  600: 3,
  700: 1.5,
  800: 1.2,
};

/** Share of the ink's own contrast each floor may ask for, when the ink is weak. */
const FLOOR_CAP_SHARE: Partial<Record<GrayStep, number>> = {
  400: 0.9,
  500: 0.85,
  600: 0.6,
  700: 0.3,
  800: 0.22,
};

function mixLab(a: Lab, b: Lab, t: number): Lab {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Each step's position between background (0) and ink (1), floors applied. */
function scalePositions(bg: RGB, ink: RGB): Record<GrayStep, number> {
  const bgLab = rgbToOklab(bg);
  const inkLab = rgbToOklab(ink);
  const inkContrast = contrastRatio(ink, bg);
  const at = (t: number) => oklabToRgb(mixLab(bgLab, inkLab, t));

  const positions = { ...STEP_POSITION };
  for (const step of GRAY_STEPS) {
    const floor = STEP_FLOOR[step];
    if (!floor) continue;
    const cap = inkContrast * (FLOOR_CAP_SHARE[step] ?? 1);
    const min = Math.max(1, Math.min(floor + HEADROOM, cap));
    if (contrastRatio(at(positions[step]), bg) >= min) continue;
    let lo = positions[step];
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(at(mid), bg) >= min) hi = mid;
      else lo = mid;
    }
    positions[step] = hi;
  }
  // Keep the scale in order: a lower step never sits closer to the
  // background than the step after it.
  for (let i = GRAY_STEPS.length - 2; i >= 0; i--) {
    const step = GRAY_STEPS[i];
    const next = GRAY_STEPS[i + 1];
    positions[step] = Math.max(positions[step], positions[next]);
  }
  return positions;
}

function scaleColors(bg: RGB, ink: RGB, positions: Record<GrayStep, number>): Record<GrayStep, string> {
  const bgLab = rgbToOklab(bg);
  const inkLab = rgbToOklab(ink);
  const out = {} as Record<GrayStep, string>;
  for (const step of GRAY_STEPS) out[step] = toHex(oklabToRgb(mixLab(bgLab, inkLab, positions[step])));
  return out;
}

export function buildNeutralScale(bg: RGB, ink: RGB): Record<GrayStep, string> {
  return scaleColors(bg, ink, scalePositions(bg, ink));
}

/**
 * How much further toward the ink the mixer's surface steps sit, so its
 * strips, knobs and fader tracks read as solid cards rather than faint tints.
 */
const MIXER_SURFACE_BUMP: Partial<Record<GrayStep, number>> = {
  600: 0.06,
  700: 0.07,
  800: 0.07,
  900: 0.05,
};

/** The mixer's slightly more solid surface steps (600 to 900). */
export function buildMixerSurfaces(bg: RGB, ink: RGB): Partial<Record<GrayStep, string>> {
  const positions = scalePositions(bg, ink);
  const bgLab = rgbToOklab(bg);
  const inkLab = rgbToOklab(ink);
  const at = (t: number) => oklabToRgb(mixLab(bgLab, inkLab, t));
  // Readouts on the cards are gray-400; a bump never costs them legibility.
  const readout = at(positions[400]);
  const bumped = { ...positions };
  for (const [key, bump] of Object.entries(MIXER_SURFACE_BUMP)) {
    const step = Number(key) as GrayStep;
    const need = Math.min(3 + HEADROOM, contrastRatio(readout, at(positions[step])));
    let b = bump;
    while (b > 0.005 && contrastRatio(readout, at(positions[step] + b)) < need) b /= 2;
    bumped[step] = positions[step] + (b > 0.005 ? b : 0);
  }
  // Stay below the text steps above them (500 and up).
  for (let i = GRAY_STEPS.indexOf(600); i < GRAY_STEPS.length; i++) {
    const step = GRAY_STEPS[i];
    bumped[step] = Math.min(bumped[step], bumped[GRAY_STEPS[i - 1]]);
  }
  const colors = scaleColors(bg, ink, bumped);
  const out: Partial<Record<GrayStep, string>> = {};
  for (const key of Object.keys(MIXER_SURFACE_BUMP)) out[Number(key) as GrayStep] = colors[Number(key) as GrayStep];
  return out;
}

/**
 * Accent hues the band page uses as text or thin borders straight on the
 * page background (current chord marker, links, errors...), with Tailwind's
 * stock values and the contrast each needs.
 */
export const ACCENTS: { name: string; value: string; min: number }[] = [
  { name: 'amber-300', value: 'oklch(87.9% 0.169 91.605)', min: 4.5 },
  { name: 'amber-400', value: 'oklch(82.8% 0.189 84.429)', min: 3 },
  { name: 'amber-500', value: 'oklch(76.9% 0.188 70.08)', min: 4.5 },
  { name: 'yellow-200', value: 'oklch(94.5% 0.129 101.54)', min: 4.5 },
  { name: 'yellow-300', value: 'oklch(90.5% 0.182 98.111)', min: 4.5 },
  { name: 'blue-300', value: 'oklch(80.9% 0.105 251.813)', min: 4.5 },
  { name: 'blue-400', value: 'oklch(70.7% 0.165 254.624)', min: 4.5 },
  { name: 'blue-500', value: 'oklch(62.3% 0.214 259.815)', min: 3 },
  { name: 'red-300', value: 'oklch(80.8% 0.114 19.571)', min: 4.5 },
  { name: 'red-400', value: 'oklch(70.4% 0.191 22.216)', min: 4.5 },
  { name: 'green-400', value: 'oklch(79.2% 0.209 151.711)', min: 4.5 },
  { name: 'purple-300', value: 'oklch(82.7% 0.119 306.383)', min: 4.5 },
  { name: 'orange-400', value: 'oklch(75% 0.183 55.934)', min: 4.5 },
];

/** Accent overrides for `bg`: only the ones whose stock value falls short. */
export function buildAccentOverrides(bg: RGB): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, value, min } of ACCENTS) {
    const lab = parseOklch(value);
    if (contrastRatio(oklabToRgb(lab), bg) >= min) continue;
    out[name] = toHex(liftLightness(lab, bg, min));
  }
  return out;
}

export interface BandTheme {
  /** CSS custom properties to set on the band page root. */
  vars: Record<string, string>;
  /** The text color actually used. */
  ink: string;
  /** True when the band's text color had to be changed to read clearly. */
  inkAdjusted: boolean;
}

/**
 * The band page's color variables for `colors`, or null when there's no
 * band or its background can't be parsed (the stock theme then applies).
 */
export function bandTheme(colors: Pick<BandColors, 'background' | 'text'> | null | undefined): BandTheme | null {
  if (!colors) return null;
  const bg = parseHex(colors.background);
  if (!bg) return null;
  const text = parseHex(colors.text);
  const ink = resolveInk(bg, text);
  const inkHex = toHex(ink);
  const vars: Record<string, string> = { '--band-ink': inkHex };
  const scale = buildNeutralScale(bg, ink);
  for (const step of GRAY_STEPS) vars[`--color-gray-${step}`] = scale[step];
  for (const [step, hex] of Object.entries(buildMixerSurfaces(bg, ink))) vars[`--mixer-gray-${step}`] = hex;
  for (const [name, hex] of Object.entries(buildAccentOverrides(bg))) vars[`--color-${name}`] = hex;
  return {
    vars,
    ink: inkHex,
    inkAdjusted: !text || toHex(text) !== inkHex,
  };
}
