import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  DEFAULT_PAGE_BG,
  DEFAULT_PAGE_TEXT,
  GRAY_STEPS,
  INK_MIN,
  bandTheme,
  contrastHex,
  parseHex,
  relativeLuminance,
} from './bandTheme';

const CASES: [string, string, string][] = [
  ['stock navy', DEFAULT_PAGE_BG, DEFAULT_PAGE_TEXT],
  ['white', '#ffffff', '#111111'],
  ['black', '#000000', '#ffffff'],
  ['pale yellow', '#fff6c2', '#fffbe0'],
  ['mid gray', '#808080', '#909090'],
  ['saturated yellow', '#ffff00', '#ffff00'],
  ['saturated blue', '#0000ff', '#2222ff'],
  ['text equals background', '#3a6b4c', '#3a6b4c'],
  ['light text on light bg', '#e8e0d0', '#ffffff'],
  ['three-digit hex', '#fff', '#000'],
];

describe('bandTheme', () => {
  it('returns null without a parseable background', () => {
    expect(bandTheme(null)).toBeNull();
    expect(bandTheme({ background: 'tomato', text: '#fff' })).toBeNull();
  });

  it('keeps a text color that already reads clearly', () => {
    const t = bandTheme({ background: '#ffffff', text: '#123456' })!;
    expect(t.ink).toBe('#123456');
    expect(t.inkAdjusted).toBe(false);
  });

  it('flags and fixes a text color that does not', () => {
    const t = bandTheme({ background: '#ffffff', text: '#ffeeaa' })!;
    expect(t.inkAdjusted).toBe(true);
    expect(contrastHex(t.ink, '#ffffff')).toBeGreaterThanOrEqual(INK_MIN);
  });

  for (const [label, bg, text] of CASES) {
    describe(label, () => {
      const theme = bandTheme({ background: bg, text })!;
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
    const t = bandTheme({ background: DEFAULT_PAGE_BG, text: DEFAULT_PAGE_TEXT })!;
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
    const t = bandTheme({ background: '#808080', text: '#000' })!;
    // `--mixer-gray-*` only acts through `.mixer-surfaces`, so it needs no reset.
    const themed = Object.keys(t.vars).filter((k) => !k.startsWith('--mixer-'));
    for (const name of [...themed, ...ACCENTS.map((a) => `--color-${a.name}`)]) {
      expect(block).toContain(`${name}:`);
    }
  });
});
