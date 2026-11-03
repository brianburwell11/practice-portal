/**
 * The part of muse-encore's API the page view uses.
 *
 * muse-encore (GPL-3.0-only, vendored as a submodule at `vendor/muse-encore`)
 * is TypeScript written for a looser compiler setup than ours (it uses enums,
 * which `erasableSyntaxOnly` rejects). So `tsc` never reads its source: it sees
 * only these declarations, and Vite compiles the real `src/index.ts` through
 * the `muse-encore` alias in `vite.config.ts`.
 *
 * Keep this in step with the pinned commit when bumping the submodule.
 */
declare module 'muse-encore' {
  /** An imported score. Opaque apart from the few members used here. */
  export interface MasterScore {
    parts(): MuseEncorePart[];
    /** First measure in written order; walk on with `nextMeasure()`. */
    firstMeasure(): MuseEncoreMeasure | null;
  }

  export interface MuseEncoreMeasure {
    nextMeasure(): MuseEncoreMeasure | null;
    /** Start position; `.ticks()` is the raw tick. */
    tick(): { ticks(): number };
    /** 0-based measure number. */
    no(): number;
  }

  export interface MuseEncorePart {
    partName(): string;
    show(): boolean;
    setShow(val: boolean): void;
  }

  export type FontFileLoader = (path: string) => Promise<ArrayBuffer | Uint8Array>;

  /** Loads the music and text fonts and the engraving data files. Call once, before importing. */
  export function initEngravingFonts(load: FontFileLoader): Promise<void>;
  export function fontsInitialized(): boolean;

  /** Reads a MuseScore file: a .mscz archive or plain .mscx text. Fonts must be initialized first. */
  export function loadScore(data: Uint8Array | ArrayBuffer): MasterScore;

  /** Imports a MusicXML (or other) file; the suffix of `fileName` picks the reader. */
  export function importScore(
    data: Uint8Array | ArrayBuffer,
    fileName: string,
    options?: { forceMode?: boolean },
  ): Promise<MasterScore>;

  export function layoutScore(score: MasterScore): void;

  export type ViewMode = 'page' | 'continuous-horizontal' | 'continuous-vertical' | 'fit-width';
  /** Sets the layout mode; `width` (inches) is the system width for 'fit-width'. True if it re-laid out. */
  export function setViewMode(score: MasterScore, mode: ViewMode, width?: number): boolean;

  export function pageCount(score: MasterScore): number;
  /** Page size in inches. */
  export function pageSize(score: MasterScore, pageIdx?: number): { width: number; height: number };
  export function scoreTitle(score: MasterScore): string;

  export interface DrawPageOptions {
    /** Canvas pixels per inch (default 100). */
    dpi?: number;
    /** Fill the page white first (default true). */
    background?: boolean;
    /** Draw like printing (default true). */
    printing?: boolean;
    /** Only this part of the page, in canvas pixels at `dpi` from the page's top left. */
    region?: { x: number; y: number; width: number; height: number };
  }
  export function drawPage(
    score: MasterScore,
    pageIdx: number,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options?: DrawPageOptions,
  ): void;

  export interface PlayalongMeasure {
    /** Index in the played order. */
    index: number;
    /** Raw start tick (the same measure can be played several times). */
    tick: number;
    /** Start tick in the played (unrolled) order. */
    utick: number;
    ticks: number;
    /** Measure number shown to the user (1-based). */
    number: number;
    /** Repeat segment the measure is played in. */
    repeatSegment: number;
  }
  /** The measures in the order they are played, repeats expanded. */
  export function playalongMeasures(score: MasterScore, partIds?: readonly string[] | null): PlayalongMeasure[];

  /** The playback cursor at a raw tick (inches from its page's top left): where the note at that tick is. */
  export function playbackCursorBounds(
    score: MasterScore,
    tick: number,
  ): { page: number; x: number; y: number; width: number; height: number } | null;

  /** The measure's rectangle (inches from its page's top left; the height of its system). */
  export function playalongMeasureBounds(
    score: MasterScore,
    tick: number,
  ): { page: number; x: number; y: number; width: number; height: number } | null;
}
