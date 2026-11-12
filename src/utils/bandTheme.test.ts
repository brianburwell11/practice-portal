import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_PAGE_BG,
  DEFAULT_PAGE_TEXT,
  GRAY_STEPS,
  INK_MIN,
  autoInk,
  bandTheme,
  buildAccentScale,
  contrastHex,
  parseHex,
  relativeLuminance,
} from './bandTheme';

const CASES: [string, string][] = [
  ['stock navy', DEFAULT_PAGE_BG],
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['pale yellow', '#fff6c2'],
  ['mid gray', '#808080'],
  ['saturated yellow', '#ffff00'],
  ['saturated blue', '#0000ff'],
  ['forest green', '#3a6b4c'],
  ['beige', '#e8e0d0'],
  ['three-digit hex', '#fff'],
];

describe('bandTheme', () => {
  it('returns null without a parseable background', () => {
    expect(bandTheme(null)).toBeNull();
    expect(bandTheme({ background: 'tomato' })).toBeNull();
  });

  it('picks the stock light text on dark backgrounds and near-black on light ones', () => {
    expect(autoInk(DEFAULT_PAGE_BG)).toBe(DEFAULT_PAGE_TEXT);
    expect(autoInk('#ffffff')).toBe('#111827');
    expect(autoInk('#fff6c2')).toBe('#111827');
  });

  it('falls back to pure black or white when neither reaches the minimum', () => {
    expect(autoInk('#808080')).toBe('#000000');
    expect(autoInk('#585858')).toBe('#ffffff');
  });

  for (const [label, bg] of CASES) {
    describe(label, () => {
      const theme = bandTheme({ background: bg })!;
      const gray = (s: number) => theme.vars[`--color-gray-${s}`];
      const best = Math.max(contrastHex('#000000', bg), contrastHex('#ffffff', bg));

      it('ink reads clearly', () => {
        expect(contrastHex(theme.ink, bg)).toBeGreaterThanOrEqual(Math.min(INK_MIN, best) - 0.01);
      });

      it('active, upcoming and past text meet their floors', () => {
        const ink = contrastHex(theme.ink, bg);
        for (const s of [50, 100, 200, 300]) expect(contrastHex(gray(s), bg)).toBeGreaterThanOrEqual(Math.min(7, ink) - 0.05);
        for (const s of [400, 500]) expect(contrastHex(gray(s), bg)).toBeGreaterThanOrEqual(Math.min(4.5, ink * 0.85) - 0.05);
        expect(contrastHex(gray(600), bg)).toBeGreaterThanOrEqual(Math.min(3, ink * 0.6) - 0.05);
      });

      it('surfaces still show against the background', () => {
        expect(contrastHex(gray(800), bg)).toBeGreaterThan(1.1);
      });

      it('scale runs in order from ink to background', () => {
        const toward = (hex: string) => contrastHex(hex, bg);
        for (let i = 0; i < GRAY_STEPS.length - 2; i++) {
          expect(toward(gray(GRAY_STEPS[i]))).toBeGreaterThanOrEqual(toward(gray(GRAY_STEPS[i + 1])) - 0.01);
        }
      });

      it('mixer cards are a bit more solid, and their readouts still read', () => {
        expect(contrastHex(theme.vars['--mixer-gray-800'], bg)).toBeGreaterThanOrEqual(contrastHex(gray(800), bg) - 0.01);
        expect(contrastHex(gray(400), theme.vars['--mixer-gray-800'])).toBeGreaterThanOrEqual(Math.min(3, contrastHex(gray(400), gray(800))) - 0.05);
      });

      it('accent hues used as text meet their floors', () => {
        for (const { name, min } of ACCENTS) {
          const override = theme.vars[`--color-${name}`];
          if (override) expect(contrastHex(override, bg)).toBeGreaterThanOrEqual(Math.min(min, best) - 0.05);
        }
      });
    });
  }

  it('leaves the stock navy page nearly as it was', () => {
    const t = bandTheme({ background: DEFAULT_PAGE_BG })!;
    // Text-bright steps stay bright, surfaces stay dark.
    expect(relativeLuminance(parseHex(t.vars['--color-gray-100'])!)).toBeGreaterThan(0.8);
    expect(relativeLuminance(parseHex(t.vars['--color-gray-800'])!)).toBeLessThan(0.05);
    // No accent needs help on the stock page.
    expect(Object.keys(t.vars).filter((k) => /amber|blue|red|green/.test(k))).toEqual([]);
  });
});

describe('.theme-default in index.css', () => {
  it('resets every variable a band theme can set', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    const block = /\.theme-default\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const t = bandTheme({ background: '#808080', accent: '#f59e0b' })!;
    // `--mixer-gray-*` only acts through `.mixer-surfaces`, so it needs no reset.
    const themed = Object.keys(t.vars).filter((k) => !k.startsWith('--mixer-'));
    for (const name of [...themed, ...ACCENTS.map((a) => `--color-${a.name}`)]) {
      expect(block).toContain(`${name}:`);
    }
  });
});

describe('band accent', () => {
  it('is blue-500, with the other blues built around it', () => {
    const t = bandTheme({ background: DEFAULT_PAGE_BG, accent: '#e11d48' })!;
    expect(t.vars['--color-blue-500']).toBe('#e11d48');
    const lum = (step: number) => relativeLuminance(parseHex(t.vars[`--color-blue-${step}`])!);
    expect(lum(600)).toBeLessThan(lum(500));
    expect(lum(300)).toBeGreaterThan(lum(500));
  });

  it('keeps the blues used as text readable on the background', () => {
    for (const [, bg] of CASES) {
      const scale = buildAccentScale(parseHex('#3b82f6')!, parseHex(bg)!);
      for (const step of [200, 300, 400]) {
        const best = Math.max(contrastHex('#000000', bg), contrastHex('#ffffff', bg));
        expect(contrastHex(scale[`blue-${step}`], bg)).toBeGreaterThanOrEqual(Math.min(4.5, best) - 0.05);
      }
    }
  });

  it('puts dark text on a light accent and white on a dark one', () => {
    expect(bandTheme({ background: DEFAULT_PAGE_BG, accent: '#fde047' })!.vars['--color-accent-ink']).not.toBe('#ffffff');
    expect(bandTheme({ background: DEFAULT_PAGE_BG, accent: '#1d4ed8' })!.vars['--color-accent-ink']).toBe('#ffffff');
  });

  it('picks legible text for a fill of the accent itself', () => {
    for (const accent of ['#fde047', '#1d4ed8', '#22c55e', '#e11d48', '#ffffff', '#000000']) {
      const t = bandTheme({ background: DEFAULT_PAGE_BG, accent })!;
      const best = Math.max(contrastHex('#111827', accent), contrastHex('#ffffff', accent));
      expect(contrastHex(t.vars['--color-on-accent'], accent)).toBe(best);
      // The gradient's deep end only ever reads better.
      expect(contrastHex(t.vars['--color-on-accent'], t.vars['--color-accent-deep'])).toBeGreaterThanOrEqual(best - 0.01);
    }
  });

  it('leaves the blues alone without an accent', () => {
    const t = bandTheme({ background: '#ffffff' })!;
    expect(t.vars['--color-blue-600']).toBeUndefined();
    expect(t.vars['--color-accent-ink']).toBeUndefined();
  });
});
