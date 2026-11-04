/**
 * The sheet music engraving engine: a thin wrapper around muse-encore
 * (GPL-3.0-only, vendored at `vendor/muse-encore`), a TypeScript port of
 * MuseScore Studio's layout engine. The scrolling strip uses MuseScore's
 * continuous view ('line'); the page view uses pages or a reflow.
 *
 * Loaded on demand (dynamic import), so first paint never pays for it.
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
import type { MasterScore } from 'muse-encore';
import { zipSync } from 'fflate';
import { extractEntries, isZip, scoreBytesToXml, UnsafeArchiveError } from '../../../utils/safeUnzip';

export type ScoreSource =
  | { kind: 'musicxml'; xml: string }
  /** `modified` (YYYY-MM-DD) fills MuseScore's `$M` (file date) in headers and footers. */
  | { kind: 'mscz'; bytes: Uint8Array; modified?: string };

/**
 * - 'page': MuseScore's own pages and breaks.
 * - 'fit-width': systems re-wrapped to a width (inches).
 * - 'line': MuseScore's continuous view, the whole score on one line.
 */
export type ScoreLayout =
  | { mode: 'page' }
  | { mode: 'fit-width'; widthInches: number }
  | { mode: 'line' };

/** All a .mscz may unpack to here: the score, its style and its pictures. */
const MSCZ_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

/** The entries of a .mscz that rendering uses; thumbnails, audio and part excerpts are skipped. */
function isRenderedMsczEntry(name: string): boolean {
  if (!name.includes('/')) return /\.mscx$/i.test(name) || name === 'score_style.mss';
  return name.startsWith('Pictures/');
}

/**
 * A .mscz as a small archive we built ourselves from its checked entries.
 * With `modified`, MuseScore's `$M` (file date) macro in the style's headers
 * and footers is filled in, which muse-encore can't do without file info.
 */
function sanitizeMscz(bytes: Uint8Array, modified?: string): Uint8Array {
  if (!isZip(bytes)) throw new UnsafeArchiveError('Not a MuseScore (.mscz) file');
  const entries = extractEntries(bytes, isRenderedMsczEntry, MSCZ_MAX_TOTAL_BYTES);
  if (![...entries.keys()].some((n) => /\.mscx$/i.test(n))) {
    throw new UnsafeArchiveError('No score inside MuseScore file');
  }
  const style = entries.get('score_style.mss');
  if (style && modified && /^\d{4}-\d{2}-\d{2}$/.test(modified)) {
    const text = new TextDecoder().decode(style).replace(
      /(<(?:even|odd)(?:Header|Footer)[LCR]>)([^<]*)(<\/)/g,
      (_m, open: string, body: string, close: string) => open + body.replaceAll('$M', modified) + close,
    );
    entries.set('score_style.mss', new TextEncoder().encode(text));
  }
  return zipSync(Object.fromEntries(entries), { level: 0 });
}

type MuseEncore = typeof import('muse-encore');

/** muse-encore internals used for the header position (not part of its public API). */
interface InternalItem {
  visible(): boolean;
  pageBoundingRect(): { left(): number };
}
interface InternalScore {
  nstaves(): number;
  style(): { spatium(): number };
  firstMeasure(): {
    system(): {
      pagePos(): { x(): number };
      leftMargin(): number;
      brackets(): InternalItem[];
      staff(i: number): { show(): boolean; instrumentNames: InternalItem[] } | null;
    } | null;
  } | null;
}
/** muse-encore's layout units per inch. */
const UNITS_PER_INCH = 1200;

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

/**
 * Starts loading the engine and its fonts without waiting for them, so they
 * download while something else (the song's audio, the score file) does.
 * Resolves when they're ready; never rejects (a failure is retried by
 * whoever needs the engine next).
 */
export function preloadScoreEngine(): Promise<void> {
  return loadEngine().then(() => undefined, () => undefined);
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
      ? me.loadScore(sanitizeMscz(source.bytes, source.modified))
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
    if (layout.mode === 'fit-width') return me.setViewMode(score, 'fit-width', layout.widthInches);
    return me.setViewMode(score, layout.mode === 'line' ? 'continuous-horizontal' : 'page');
  }

  private static keyOf(layout: ScoreLayout): string {
    return layout.mode === 'fit-width' ? `fit:${layout.widthInches.toFixed(2)}` : layout.mode;
  }

  /** Lays out again for a new layout. Returns false when nothing changed. */
  relayout(layout: ScoreLayout): boolean {
    const key = ScoreEngine.keyOf(layout);
    if (key === this.layoutKey) return false;
    const t0 = performance.now();
    ScoreEngine.applyLayoutMode(this.me, this.score, layout);
    this.timings.layoutMs = performance.now() - t0;
    this.layoutKey = key;
    this.invalidate();
    return true;
  }

  private bounds: { top: number; bottom: number } | null = null;
  private beatStarts: (number | null)[] | null = null;

  private invalidate(): void {
    this.rects = null;
    this.bounds = null;
    this.beatStarts = null;
  }

  /**
   * The rows of page 0 that have ink on them, in inches: drawn once at low
   * resolution and scanned, so page margins can be cropped without guessing
   * how far chord symbols, marks or dynamics reach. For the 'line' layout.
   */
  contentBounds(): { top: number; bottom: number } {
    if (this.bounds) return this.bounds;
    const PROBE_DPI = 12;
    const size = this.pageSize(0);
    const fallback = { top: 0, bottom: size.height };
    const w = Math.min(16000, Math.ceil(size.width * PROBE_DPI));
    const h = Math.ceil(size.height * PROBE_DPI);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || w === 0 || h === 0) return (this.bounds = fallback);
    this.me.drawPage(this.score, 0, ctx, { dpi: PROBE_DPI, region: { x: 0, y: 0, width: w, height: h } });
    const data = ctx.getImageData(0, 0, w, h).data;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      let ink = false;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) { ink = true; break; }
      }
      if (ink) { if (top < 0) top = y; bottom = y; }
    }
    if (top < 0) return (this.bounds = fallback);
    // One probe pixel of slack either side, for antialiased edges.
    this.bounds = {
      top: Math.max(0, (top - 1) / PROBE_DPI),
      bottom: Math.min(size.height, (bottom + 2) / PROBE_DPI),
    };
    return this.bounds;
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
   * MuseScore's continuous panel for the 'line' layout: staff names, brackets,
   * and the clef, key and time signature in force at `leftInches` into the
   * page. See `drawContinuousPanel` in src/types/muse-encore.d.ts.
   */
  drawContinuousPanel(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    dpi: number,
    leftInches: number,
    topInches: number,
    shownKey?: string,
  ): { width: number; key: string; painted: boolean } | null {
    return this.me.drawContinuousPanel(this.score, ctx, { dpi, left: leftInches, top: topInches, shownKey });
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

  /**
   * Where each written measure's first beat is (x in inches on its page),
   * past any clef, key or time signature at the start of its system, or
   * null. Built once per layout.
   */
  measureBeatStarts(): (number | null)[] {
    if (this.beatStarts) return this.beatStarts;
    const starts: (number | null)[] = [];
    for (let m = this.score.firstMeasure(); m; m = m.nextMeasure()) {
      starts.push(this.me.playbackCursorBounds(this.score, m.tick().ticks())?.x ?? null);
    }
    this.beatStarts = starts;
    return starts;
  }

  /**
   * Where the first system's header begins (inches into the page): its
   * leftmost instrument name or bracket, less half a staff space, the same
   * point MuseScore's continuous panel draws its header from. So a panel
   * placed here matches the score's own header exactly.
   */
  headerLeft(): number | null {
    const score = this.score as unknown as InternalScore;
    const system = score.firstMeasure()?.system();
    if (!system) return null;
    const spatium = score.style().spatium();
    const staffStart = system.pagePos().x() + system.leftMargin();
    const items: InternalItem[] = [...system.brackets()];
    for (let i = 0; i < score.nstaves(); i++) {
      const staff = system.staff(i);
      if (staff?.show()) items.push(...staff.instrumentNames);
    }
    let left = staffStart;
    for (const item of items) {
      if (item.visible()) left = Math.min(left, item.pageBoundingRect().left() - 0.5 * spatium);
    }
    return left / UNITS_PER_INCH;
  }

  /** Where the first measure's first beat is (inches): past the clef, key and time signature. */
  firstBeatX(): number | null {
    const m = this.score.firstMeasure();
    return m ? this.me.playbackCursorBounds(this.score, m.tick().ticks())?.x ?? null : null;
  }

  /** Written measure index at a point on a page (inches), or -1. */
  measureAt(page: number, x: number, y: number): number {
    const rects = this.measureRects();
    return rects.findIndex((r) => !!r && r.page === page
      && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  }

  parts(): { name: string; shown: boolean }[] {
    return this.score.parts().map((p) => ({ name: p.partName(), shown: p.show() }));
  }

  /** Hides the parts at these indices (instrument order), shows the rest, and lays out again. */
  setHiddenParts(hiddenIndices: ReadonlySet<number>): boolean {
    let changed = false;
    this.score.parts().forEach((p, i) => {
      const show = !hiddenIndices.has(i);
      if (p.show() !== show) { p.setShow(show); changed = true; }
    });
    if (!changed) return false;
    this.me.layoutScore(this.score);
    this.invalidate();
    return true;
  }
}

/** Where a song's score files are, as resolved URLs. */
export interface SongScoreFiles {
  /** The MusicXML (.mxl) score: the repeat structure, and what's drawn without a .mscz. */
  mxlUrl: string;
  /** The original MuseScore file, drawn when present. */
  msczUrl?: string;
  /** YYYY-MM-DD date of the MuseScore file, for `$M`. */
  modified?: string;
}

/**
 * Fetches a song's score files: the MusicXML text (always, for the repeat
 * structure) and what to draw (the .mscz when there is one). A .mscz that
 * fails to download falls back to drawing the MusicXML.
 */
export async function fetchSongScore(files: SongScoreFiles): Promise<{ xml: string; source: ScoreSource }> {
  const fetchBytes = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const [mxl, mscz] = await Promise.all([
    fetchBytes(files.mxlUrl),
    files.msczUrl ? fetchBytes(files.msczUrl).catch((e) => { console.warn('MuseScore file failed to load, drawing the MusicXML', e); return null; }) : null,
  ]);
  const xml = scoreBytesToXml(mxl);
  const source: ScoreSource = mscz ? { kind: 'mscz', bytes: mscz, modified: files.modified } : { kind: 'musicxml', xml };
  return { xml, source };
}

/** MusicXML part ids in instrument order (saved hidden parts use them). */
export function scorePartIds(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.querySelectorAll('score-part')).map((el) => el.getAttribute('id') ?? '');
}
