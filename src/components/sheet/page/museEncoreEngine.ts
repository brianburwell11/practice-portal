/**
 * The page view's engraving engine: a thin wrapper around muse-encore
 * (GPL-3.0-only, vendored at `vendor/muse-encore`), a TypeScript port of
 * MuseScore Studio's layout engine.
 *
 * Everything here is loaded on demand, the first time the page view opens,
 * so the scrolling strip and first paint never pay for it.
 *
 * Two sources:
 * - MuseScore files (.mscz) render exactly as MuseScore lays them out: their
 *   own style, breaks and manual adjustments.
 * - MusicXML is re-laid out by MuseScore's engine (close, but MusicXML
 *   doesn't carry MuseScore's layout).
 *
 * Untrusted input: muse-encore unzips with no size limits, so it never sees an
 * uploaded archive. MusicXML arrives as text that `scoreBytesToXml` has
 * already unzipped and size-checked, imported as `score.musicxml` (no unzip).
 * A .mscz is opened with our bounded reader, only the entries rendering needs
 * are kept, and they are re-zipped uncompressed for `loadScore`, which then
 * unzips an archive we built.
 */
import type { MasterScore, PlayalongMeasure } from 'muse-encore';
import { zipSync } from 'fflate';
import { extractEntries, isZip, UnsafeArchiveError } from '../../../utils/safeUnzip';

export type ScoreSource =
  | { kind: 'musicxml'; xml: string }
  | { kind: 'mscz'; bytes: Uint8Array };

/** 'page': MuseScore's own pages and breaks. 'fit-width': systems re-wrapped to a width (inches). */
export type ScoreLayout = { mode: 'page' } | { mode: 'fit-width'; widthInches: number };

/** All a .mscz may unpack to here: the score, its style and its pictures. */
const MSCZ_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/** The entries of a .mscz that rendering uses; thumbnails, audio and part excerpts are skipped. */
function isRenderedMsczEntry(name: string): boolean {
  if (!name.includes('/')) return /\.mscx$/i.test(name) || name === 'score_style.mss';
  return name.startsWith('Pictures/');
}

/** A .mscz as a small archive we built ourselves from its checked entries. */
function sanitizeMscz(bytes: Uint8Array): Uint8Array {
  if (!isZip(bytes)) throw new UnsafeArchiveError('Not a MuseScore (.mscz) file');
  const entries = extractEntries(bytes, isRenderedMsczEntry, MSCZ_MAX_TOTAL_BYTES);
  if (![...entries.keys()].some((n) => /\.mscx$/i.test(n))) {
    throw new UnsafeArchiveError('No score inside MuseScore file');
  }
  return zipSync(Object.fromEntries(entries), { level: 0 });
}

type MuseEncore = typeof import('muse-encore');

/** Rectangle of one written measure, in inches from the top left of its page. */
export interface MeasureRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EngineTimings {
  fontsMs: number;
  importMs: number;
  layoutMs: number;
}

// Every font and data file muse-encore asks for, emitted by Vite as hashed
// assets (long-cached) and fetched only when asked for.
const FONT_FILES = import.meta.glob('/vendor/muse-encore/fonts/**/*.{otf,ttf,json,xml,mss}', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;
const FONT_ROOT = '/vendor/muse-encore/fonts/';

let enginePromise: Promise<{ me: MuseEncore; fontsMs: number }> | null = null;

/** Loads muse-encore and its fonts once per page load. */
function loadEngine(): Promise<{ me: MuseEncore; fontsMs: number }> {
  enginePromise ??= (async () => {
    const me = await import('muse-encore');
    const t0 = performance.now();
    if (!me.fontsInitialized()) {
      await me.initEngravingFonts(async (path) => {
        const urlOf = FONT_FILES[FONT_ROOT + path];
        if (!urlOf) throw new Error(`Missing score font file: ${path}`);
        const res = await fetch(await urlOf());
        if (!res.ok) throw new Error(`Score font ${path} failed to load (${res.status})`);
        return res.arrayBuffer();
      });
    }
    return { me, fontsMs: performance.now() - t0 };
  })();
  // Let a failed load (offline, say) be retried next time.
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

export class ScoreEngine {
  private layoutKey = '';
  private rects: (MeasureRect | null)[] | null = null;

  private readonly me: MuseEncore;
  private readonly score: MasterScore;
  readonly timings: EngineTimings;

  private constructor(me: MuseEncore, score: MasterScore, timings: EngineTimings) {
    this.me = me;
    this.score = score;
    this.timings = timings;
  }

  /** Opens a score and lays it out. */
  static async open(source: ScoreSource, layout: ScoreLayout): Promise<ScoreEngine> {
    const { me, fontsMs } = await loadEngine();
    const t0 = performance.now();
    const score = source.kind === 'mscz'
      ? me.loadScore(sanitizeMscz(source.bytes))
      : await me.importScore(new TextEncoder().encode(source.xml), 'score.musicxml');
    const t1 = performance.now();
    ScoreEngine.applyLayoutMode(me, score, layout);
    me.layoutScore(score);
    const t2 = performance.now();
    const engine = new ScoreEngine(me, score, { fontsMs, importMs: t1 - t0, layoutMs: t2 - t1 });
    engine.layoutKey = ScoreEngine.keyOf(layout);
    return engine;
  }

  private static applyLayoutMode(me: MuseEncore, score: MasterScore, layout: ScoreLayout): boolean {
    return layout.mode === 'page'
      ? me.setViewMode(score, 'page')
      : me.setViewMode(score, 'fit-width', layout.widthInches);
  }

  private static keyOf(layout: ScoreLayout): string {
    return layout.mode === 'page' ? 'page' : `fit:${layout.widthInches.toFixed(2)}`;
  }

  /** Lays out again for a new layout. Returns false when nothing changed. */
  relayout(layout: ScoreLayout): boolean {
    const key = ScoreEngine.keyOf(layout);
    if (key === this.layoutKey) return false;
    const t0 = performance.now();
    ScoreEngine.applyLayoutMode(this.me, this.score, layout);
    this.timings.layoutMs = performance.now() - t0;
    this.layoutKey = key;
    this.rects = null;
    return true;
  }

  get title(): string {
    return this.me.scoreTitle(this.score);
  }

  pageCount(): number {
    return this.me.pageCount(this.score);
  }

  /** Page size in inches. Fit-width layout has one long page. */
  pageSize(page = 0): { width: number; height: number } {
    return this.me.pageSize(this.score, page);
  }

  /**
   * Draws `region` (canvas pixels at `dpi`, from the page's top left) of a
   * page into `ctx`, whose canvas is the size of the region.
   */
  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    page: number,
    dpi: number,
    region: { x: number; y: number; width: number; height: number },
  ): void {
    this.me.drawPage(this.score, page, ctx, { dpi, region });
  }

  /**
   * Rectangles of the measures in written order, indexed like
   * `MusicXMLStructure.measures` (and so like `UnfoldedStep.srcIndex`).
   * Built once per layout.
   */
  measureRects(): (MeasureRect | null)[] {
    if (this.rects) return this.rects;
    const rects: (MeasureRect | null)[] = [];
    for (let m = this.score.firstMeasure(); m; m = m.nextMeasure()) {
      rects.push(this.me.playalongMeasureBounds(this.score, m.tick().ticks()));
    }
    this.rects = rects;
    return rects;
  }

  /** Written measure index at a point on a page (inches), or -1. */
  measureAt(page: number, x: number, y: number): number {
    const rects = this.measureRects();
    return rects.findIndex((r) => !!r && r.page === page
      && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  }

  /** Written measure indices in the order muse-encore would play them (repeats expanded). */
  playedOrder(): number[] {
    const indexByTick = new Map<number, number>();
    let i = 0;
    for (let m = this.score.firstMeasure(); m; m = m.nextMeasure()) indexByTick.set(m.tick().ticks(), i++);
    return this.me.playalongMeasures(this.score).map((pm: PlayalongMeasure) => indexByTick.get(pm.tick) ?? -1);
  }

  parts(): { name: string; shown: boolean }[] {
    return this.score.parts().map((p) => ({ name: p.partName(), shown: p.show() }));
  }

  /** Shows only the parts not named in `hidden`, and lays out again. */
  setHiddenParts(hidden: ReadonlySet<string>): void {
    let changed = false;
    for (const p of this.score.parts()) {
      const show = !hidden.has(p.partName());
      if (p.show() !== show) { p.setShow(show); changed = true; }
    }
    if (!changed) return;
    this.me.layoutScore(this.score);
    this.rects = null;
  }
}
