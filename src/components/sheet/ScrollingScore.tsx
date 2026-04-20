import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useBandStore } from '../../store/bandStore';
import { useSheetMusicStore } from '../../store/sheetMusicStore';
import { measureStartTimes, currentMeasureIndex } from '../../audio/tempoUtils';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { r2Url } from '../../utils/url';
import {
  loadSheetMusicSongState,
  saveSheetMusicSongState,
} from '../../utils/sheetMusicSongStorage';
import { InfiniteScoreRenderer, type InfiniteBeatStamp, type PartInfo } from './InfiniteScoreRenderer';

/** Pixels to nudge the left focus point right of the waveform's left edge.
 *  Keep in sync with the same constant in `LyricsDisplay.tsx` so the
 *  lyric reading point, karaoke playhead, and window-mode first bar all
 *  line up vertically. */
const FOCUS_LEFT_NUDGE_PX = 24;

/** Pixels to extend the window-mode right boundary beyond the waveform's
 *  right edge. Only affects window mode; karaoke doesn't use the right
 *  boundary. Clamped to the scroll-host viewport. */
const FOCUS_RIGHT_NUDGE_PX = 32;

/**
 * Scrolling-sheet-music panel. Renders the current song's MusicXML if the
 * song config carries a `sheetMusicUrl`; otherwise renders nothing.
 *
 * Sync model (decided in the docs-site UX post):
 *   - Cursor granularity is **always measure**: we lerp linearly between
 *     consecutive measure taps, ignoring beat-level tap jitter.
 *   - Two user-facing tracking modes: karaoke (fixed playhead, scrolling
 *     score, no bbox) and window (static N-bar page with grayed prev/next
 *     margins, bbox spans the current measure).
 *   - Playhead line is always rendered full-system height, 2 px wide,
 *     colored with a soft glow so it's visible with or without the bbox.
 *
 * Sync plumbing mirrors `LyricsDisplay`: we read `useTransportStore.position`
 * via a Zustand selector (no RAF loop) and update scroll / bbox state in a
 * useEffect on position change.
 */
export function ScrollingScore() {
  const song = useSongStore((s) => s.selectedSong);
  const currentBand = useBandStore((s) => s.currentBand);
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const engine = useAudioEngine();
  const trackingMode = useSheetMusicStore((s) => s.trackingMode);
  const scoreZoom = useSheetMusicStore((s) => s.scoreZoom);
  const equalBeatWidthOverride = useSheetMusicStore((s) => s.equalBeatWidthOverride);
  const showPlayhead = useSheetMusicStore((s) => s.showPlayhead);
  const setTrackingMode = useSheetMusicStore((s) => s.setTrackingMode);
  const setScoreZoom = useSheetMusicStore((s) => s.setScoreZoom);
  const setEqualBeatWidthOverride = useSheetMusicStore((s) => s.setEqualBeatWidthOverride);
  const setShowPlayhead = useSheetMusicStore((s) => s.setShowPlayhead);

  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null);
  const [cursorPx, setCursorPx] = useState(0);
  const [bbox, setBbox] = useState<{ leftPx: number; widthPx: number } | null>(null);
  const [trainGrayLeftPx, setTrainGrayLeftPx] = useState(0);
  const [trainGrayRightStartPx, setTrainGrayRightStartPx] = useState<number | null>(null);
  const [windowAnchor, setWindowAnchor] = useState(0);
  /** Viewport-x where the sticky preamble (clef/key/time) sits. Slides
   *  left with the scroll in karaoke mode until it hits 0, then pins. */
  const [stickyPreambleLeftPx, setStickyPreambleLeftPx] = useState(0);
  /** Width of the preamble (clef+key sig), in SVG-local px. Derived from
   *  the first measure's barline position minus the leading-pad spacer,
   *  minus an estimate of the time signature width (which lives after the
   *  key signature but is excluded from the sticky region). */
  const [preambleWidth, setPreambleWidth] = useState(0);
  /** Live SVG ref — stored in state so a useEffect can re-mount the clone
   *  whenever either the SVG OR the host div changes. */
  const [liveSvg, setLiveSvg] = useState<SVGSVGElement | null>(null);
  /** Host div for the cloned preamble SVG. Stored via a ref callback so
   *  we get a re-render when it mounts/unmounts (the overlay is
   *  conditionally rendered, so this can appear after the SVG-ready
   *  callback already fired). */
  const [preambleHost, setPreambleHost] = useState<HTMLDivElement | null>(null);
  /** Incremented on window resize / scroll-host resize. Used as a sync-effect
   *  dependency so window-mode re-derives how many bars fit when the
   *  viewport changes (browser resize, mobile rotate, etc.). */
  const [resizeTick, setResizeTick] = useState(0);
  /** Instrument parts discovered from the MusicXML. */
  const [parts, setParts] = useState<PartInfo[]>([]);
  /** Subset of part ids the user has hidden. Empty = show all. */
  const [hiddenPartIds, setHiddenPartIds] = useState<Set<string>>(new Set());
  const [partsMenuOpen, setPartsMenuOpen] = useState(false);
  /** Pending checkbox state inside the open dropdown. Changes don't apply
   *  until the user hits the apply button — closing the menu any other way
   *  discards them. Synced from `hiddenPartIds` on each open. */
  const [draftHiddenPartIds, setDraftHiddenPartIds] = useState<Set<string>>(new Set());
  const partsMenuRef = useRef<HTMLDivElement | null>(null);
  /** Hidden-part ids loaded from localStorage for the current song, waiting
   *  to be filtered against the discovered parts inside `handleParts`. Null
   *  when nothing is pending. While non-null, the save effect is paused so
   *  the initial empty-Set reset can't overwrite stored state. */
  const pendingSavedPartIdsRef = useRef<string[] | null>(null);

  // --- Scroll-ahead + click-to-jump refs (mirrors LyricsDisplay's pattern) ---
  /** Last `scrollLeft` we wrote programmatically. The scroll listener
   *  compares actual-vs-expected to tell our own writes from user input. */
  const expectedScrollLeftRef = useRef(0);
  /** True while the user has scrolled ahead/behind and auto-scroll is frozen. */
  const scrollLockedRef = useRef(false);
  /** Release the lock once live playback reaches this measure index. */
  const resumeAtMeasureRef = useRef(-1);
  /** Window-mode only: frozen anchor during the lock so the page doesn't
   *  auto-advance while the user is looking ahead. */
  const lockedAnchorRef = useRef(0);
  /** Latest `focusLeftPx` computed inside the sync effect, mirrored so the
   *  scroll listener can derive the reading-point content-x without
   *  re-querying the waveform rect. */
  const focusLeftPxRef = useRef(0);
  /** Latest `cursorContentX` (playhead in scroll-host content coords) and
   *  current-measure range, mirrored so the scroll listener can refresh
   *  viewport-local state (playhead, bbox) when the user scrolls while
   *  paused — the sync effect is keyed on `position` and doesn't re-run
   *  on pause-scrolls. */
  const cursorContentXRef = useRef(0);
  const measureRangeRef = useRef<{ left: number; width: number } | null>(null);
  /** Mirror of `playing` so listeners read the latest value without
   *  re-subscribing on every flip. */
  const playingRef = useRef(false);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // Click-vs-drag bookkeeping for click-to-jump.
  const pointerDownXRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  // Resolve the score URL. Following the rest of the codebase's R2 convention:
  // the field in the song config is a *filename* (e.g. "score.musicxml") that
  // lives alongside the song's other files at `{bandId}/songs/{songId}/`. If
  // the caller already supplied an absolute URL (starts with "http" or "/"),
  // we pass it through unchanged — useful for external hosting.
  const sheetMusicUrl = useMemo(() => {
    const raw = song?.sheetMusicUrl;
    if (!raw) return undefined;
    if (/^https?:\/\//.test(raw) || raw.startsWith('/')) return raw;
    if (!currentBand || !song) return undefined;
    return r2Url(`${currentBand.id}/songs/${song.id}/${raw}`);
  }, [song, currentBand]);
  const effectiveEqualBeatWidth = equalBeatWidthOverride ?? song?.equalBeatWidth ?? false;

  // tapMap-based measure-start timeline
  const measureTimes = useMemo(() => measureStartTimes(song?.tapMap), [song?.tapMap]);

  // Audio offset: explicit field in song config, else the first measure-tap time
  const audioOffset = useMemo(() => {
    if (!song) return 0;
    if (typeof song.audioOffsetSeconds === 'number') return song.audioOffsetSeconds;
    return measureTimes[0] ?? 0;
  }, [song, measureTimes]);

  const handleReady = useCallback((_osmd: any) => { /* reserved for future hook-ins */ }, []);
  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);
  const handleMeasureXs = useCallback((xs: number[]) => setMeasureXs(xs), []);
  const handleParts = useCallback((ps: PartInfo[]) => {
    setParts(ps);
    const saved = pendingSavedPartIdsRef.current;
    if (!saved || ps.length === 0) return;
    pendingSavedPartIdsRef.current = null;
    const available = new Set(ps.map((p) => p.id));
    const filtered = saved.filter((id) => available.has(id));
    // OSMD needs at least one visible instrument.
    if (filtered.length >= ps.length) return;
    setHiddenPartIds(new Set(filtered));
  }, []);

  const handleSvgReady = useCallback((svg: SVGSVGElement | null) => {
    setLiveSvg(svg);
  }, []);

  // Compute the visible-part set that drives the renderer. Memoized so
  // the renderer's visibility effect only re-fires when selection
  // genuinely changes, not on every parent re-render.
  const visiblePartIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of parts) if (!hiddenPartIds.has(p.id)) s.add(p.id);
    return s;
  }, [parts, hiddenPartIds]);

  const toggleDraftPart = useCallback((id: string) => {
    setDraftHiddenPartIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // OSMD needs at least one visible instrument — refuse to hide the
      // last one instead of silently keeping it visible.
      const remainingVisible = parts.length - next.size - 1;
      if (remainingVisible < 1) return prev;
      next.add(id);
      return next;
    });
  }, [parts.length]);

  const applyPartsDraft = useCallback(() => {
    setHiddenPartIds(new Set(draftHiddenPartIds));
    setPartsMenuOpen(false);
  }, [draftHiddenPartIds]);

  // True when the draft and committed selections diverge. Drives the
  // apply button's enabled + highlighted state.
  const draftDiffers = useMemo(() => {
    if (draftHiddenPartIds.size !== hiddenPartIds.size) return true;
    for (const id of draftHiddenPartIds) if (!hiddenPartIds.has(id)) return true;
    return false;
  }, [draftHiddenPartIds, hiddenPartIds]);

  // Bootstrap + refine the sticky preamble.
  //
  // This has to handle a chicken-and-egg: the sticky-preamble wrapper
  // only renders when `preambleWidth > 0`, and `preambleHost` only
  // populates once the wrapper is in the DOM. So we first compute a
  // `fallback` width (first-note-x minus a small gap) and set that,
  // which lets the wrapper render. On the next effect run, both
  // `liveSvg` and `preambleHost` are available and we refine the width
  // via DOM measurement — walk every <text>/<path> in the clone and
  // find the rightmost glyph whose right edge lies in the preamble
  // region (before the first note). That gives a pixel-accurate cutoff
  // at any zoom or time-signature width.
  useEffect(() => {
    if (!scrollHost || timeline.length === 0) {
      preambleHost?.replaceChildren();
      setPreambleWidth(0);
      return;
    }
    const spacerPx = scrollHost.clientWidth * 0.22;
    const firstNoteLocalX = timeline[0].xPx - spacerPx;
    const PADDING_PX = 6;
    const fallback = Math.max(40, firstNoteLocalX - PADDING_PX);

    // Step 1: bootstrap. If the host or SVG isn't ready, set the
    // fallback width so the wrapper renders and the host ref populates.
    if (!preambleHost || !liveSvg) {
      preambleHost?.replaceChildren();
      setPreambleWidth(fallback);
      return;
    }

    // Step 2: mount the clone and refine via DOM measurement.
    const clone = liveSvg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[id*="cursor"], [id*="Cursor"]').forEach((el) => el.remove());
    clone.style.display = 'block';
    preambleHost.replaceChildren(clone);

    let rightmostEdge = 0;
    const glyphs = clone.querySelectorAll('text, path');
    for (const el of Array.from(glyphs)) {
      let bbox: DOMRect | null = null;
      try { bbox = (el as SVGGraphicsElement).getBBox(); } catch { /* detached */ }
      if (!bbox) continue;
      const right = bbox.x + bbox.width;
      // Exclude staff-line paths and anything past the first note. Staff
      // lines span the full score width so the `right < firstNoteLocalX`
      // filter keeps them out automatically.
      if (right > rightmostEdge && right < firstNoteLocalX - 3) {
        rightmostEdge = right;
      }
    }

    const measured = rightmostEdge > 0 ? rightmostEdge + PADDING_PX : fallback;
    setPreambleWidth(Math.max(40, Math.min(measured, firstNoteLocalX - 2)));
  }, [liveSvg, preambleHost, scrollHost, timeline, resizeTick]);

  // Grab a handle to the renderer's scroll host the first time we render.
  // InfiniteScoreRenderer's root element *is* the scroll host, so we just
  // capture it via a ref callback on the wrapper.
  const rendererWrapperRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) { setScrollHost(null); return; }
    const host = el.querySelector('div[style*="overflow-x: auto"]') as HTMLDivElement | null
      ?? el.firstElementChild as HTMLDivElement | null;
    setScrollHost(host);
  }, [sheetMusicUrl, scoreZoom, effectiveEqualBeatWidth]);

  // Reset the window anchor whenever the song changes
  useEffect(() => { setWindowAnchor(0); }, [sheetMusicUrl]);

  // On pause or mode-switch, drop any scroll lock so the next sync tick
  // snaps the viewport back to the live playback position. Mirrors
  // LyricsDisplay's pause-clear behavior.
  useEffect(() => {
    if (playing) return;
    scrollLockedRef.current = false;
    resumeAtMeasureRef.current = -1;
  }, [playing]);
  useEffect(() => {
    scrollLockedRef.current = false;
    resumeAtMeasureRef.current = -1;
  }, [trackingMode]);

  // Reset the parts list + selection on song change so stale part ids
  // from the previous score don't leak into the new one's visibility.
  // Also seed `pendingSavedPartIdsRef` from localStorage so `handleParts`
  // can re-apply the user's last selection for this song once OSMD
  // finishes discovering the parts.
  useEffect(() => {
    setParts([]);
    setHiddenPartIds(new Set());
    setPartsMenuOpen(false);
    const songId = song?.id;
    const saved = songId ? loadSheetMusicSongState(songId) : null;
    pendingSavedPartIdsRef.current = saved?.hiddenPartIds ?? null;
  }, [sheetMusicUrl, song?.id]);

  // Debounced save of the per-song parts selection. Skipped while a
  // load is pending (ref non-null) so the transient empty-Set state
  // from the reset doesn't overwrite the stored value, and skipped
  // before parts are discovered so we don't persist a meaningless
  // empty state on first mount.
  useEffect(() => {
    const songId = song?.id;
    if (!songId) return;
    if (pendingSavedPartIdsRef.current) return;
    if (parts.length === 0) return;
    const handle = setTimeout(() => {
      saveSheetMusicSongState(songId, {
        hiddenPartIds: Array.from(hiddenPartIds),
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [song?.id, hiddenPartIds, parts.length]);

  // Close the parts dropdown when clicking outside it
  useEffect(() => {
    if (!partsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = partsMenuRef.current;
      if (el && !el.contains(e.target as Node)) setPartsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [partsMenuOpen]);

  // Sync the dropdown's draft checkboxes from the committed selection
  // whenever the menu opens, so a prior unapplied draft can't leak in.
  useEffect(() => {
    if (partsMenuOpen) setDraftHiddenPartIds(new Set(hiddenPartIds));
  }, [partsMenuOpen, hiddenPartIds]);

  // Track scroll-host + waveform sizes so the window-bars-per-page
  // calculation updates on browser resize / device rotation / layout shift.
  // The waveform is the source of truth for the window's left/right edges —
  // we align the sheet-music window to it so bars sit directly above their
  // corresponding region in the waveform.
  useEffect(() => {
    if (!scrollHost) return;
    const bump = () => setResizeTick((n) => n + 1);
    bump();
    const ro = new ResizeObserver(bump);
    ro.observe(scrollHost);
    const waveformEl = document.querySelector('[data-waveform-timeline]');
    if (waveformEl) ro.observe(waveformEl);
    return () => ro.disconnect();
  }, [scrollHost]);

  // Sync effect — runs on every transport position update via the Zustand
  // subscription. This is the same pattern LyricsDisplay uses: no RAF loop,
  // just re-derive state when `position` changes.
  useEffect(() => {
    if (!scrollHost || timeline.length === 0 || measureXs.length < 2) return;

    const t = position - audioOffset;

    // Cursor x: measure-granularity lerp between consecutive barlines
    let mIdx = 0;
    let cursorContentX: number;
    if (measureTimes.length >= 2) {
      mIdx = currentMeasureIndex(t + audioOffset, measureTimes);
      const t0 = measureTimes[mIdx];
      const t1 = measureTimes[mIdx + 1] ?? t0 + 1;
      const frac = Math.max(0, Math.min(1, (t + audioOffset - t0) / Math.max(0.001, t1 - t0)));
      const x0 = measureXs[mIdx] ?? 0;
      const x1 = measureXs[mIdx + 1] ?? x0;
      cursorContentX = x0 + frac * (x1 - x0);
    } else {
      // No tapMap measures: fall back to the first measure's x and freeze
      cursorContentX = measureXs[0] ?? 0;
    }

    cursorContentXRef.current = cursorContentX;

    // Release scroll lock once live playback reaches the scrolled-to measure.
    // Backward scroll releases immediately (live mIdx already >= resume).
    if (scrollLockedRef.current && mIdx >= resumeAtMeasureRef.current) {
      scrollLockedRef.current = false;
      resumeAtMeasureRef.current = -1;
    }
    const locked = scrollLockedRef.current;

    const viewport = scrollHost.clientWidth;

    // The waveform's bounding rect is the source of truth for the focus
    // point in *both* modes: karaoke uses its left edge as the playhead
    // position; window mode uses its left and right edges as the bar
    // window's boundaries. Falls back to sensible defaults if the
    // waveform isn't in the DOM yet (initial render / no song selected).
    //
    // A small rightward offset (FOCUS_LEFT_NUDGE_PX) is applied to the
    // LEFT edge only — the karaoke playhead / first bar sits just right
    // of the waveform's left edge, giving some breathing room before the
    // first measure. Must stay in sync with LyricsDisplay's identical
    // nudge so the two focus points still line up vertically.
    const waveformEl = document.querySelector('[data-waveform-timeline]') as HTMLElement | null;
    const hostRect = scrollHost.getBoundingClientRect();
    let focusLeftPx = viewport * 0.22;
    let focusRightPx = viewport;
    if (waveformEl) {
      const wfRect = waveformEl.getBoundingClientRect();
      focusLeftPx = Math.max(0, wfRect.left - hostRect.left);
      focusRightPx = Math.min(viewport, wfRect.right - hostRect.left + FOCUS_RIGHT_NUDGE_PX);
    }
    focusLeftPx = Math.min(focusLeftPx + FOCUS_LEFT_NUDGE_PX, focusRightPx - 40);
    // Mirror focusLeftPx into the ref so the scroll listener can derive the
    // reading-point content-x without re-querying the waveform rect.
    focusLeftPxRef.current = focusLeftPx;

    if (trackingMode === 'karaoke') {
      // Fixed playhead at the waveform's left edge; score scrolls under it.
      // When the user has scrolled ahead, freeze the viewport and let the
      // playhead drift across it (same formula window mode uses below).
      if (!locked) {
        const nextScrollLeft = Math.max(0, cursorContentX - focusLeftPx);
        expectedScrollLeftRef.current = nextScrollLeft;
        scrollHost.scrollLeft = nextScrollLeft;
        setCursorPx(focusLeftPx);
      } else {
        setCursorPx(cursorContentX - scrollHost.scrollLeft);
      }
      setBbox(null); // karaoke: no bbox, just the playhead line
      measureRangeRef.current = null;
      setTrainGrayLeftPx(0);
      setTrainGrayRightStartPx(null);
    } else {
      // Window mode:
      // - The first bar's left barline is anchored at the waveform's left
      //   edge (converted into scroll-host-local viewport coords). The
      //   last fully-fit measure ends at or before the waveform's right
      //   edge. Everything outside that window is grayed.
      const usableWidth = Math.max(1, focusRightPx - focusLeftPx);

      let anchor = locked ? lockedAnchorRef.current : windowAnchor;
      let bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);

      if (!locked) {
        if (mIdx < anchor) {
          // Seek backward — jump to a page that starts at mIdx
          anchor = mIdx;
          bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);
          setWindowAnchor(anchor);
        } else if (mIdx >= anchor + bars) {
          // Forward progress — walk page-by-page because each page has its
          // own bars-count (real measures vary in rendered width)
          let safety = 200;
          while (mIdx >= anchor + bars && safety-- > 0 && anchor + bars < measureXs.length - 1) {
            anchor = anchor + bars;
            bars = barsFittingFromAnchor(anchor, usableWidth, measureXs);
          }
          setWindowAnchor(anchor);
        }
      }

      const anchorX = measureXs[anchor] ?? 0;
      if (!locked) {
        // Scroll so the first bar's barline sits at the waveform's left edge
        const nextScrollLeft = Math.max(0, anchorX - focusLeftPx);
        expectedScrollLeftRef.current = nextScrollLeft;
        scrollHost.scrollLeft = nextScrollLeft;
      }
      setCursorPx(cursorContentX - scrollHost.scrollLeft);
      // Bbox spans the current measure (snappiness: measure, anchor: start)
      const measureLeft = measureXs[mIdx] ?? cursorContentX;
      const measureRight = measureXs[mIdx + 1] ?? (measureLeft + 120);
      const measureWidth = Math.max(20, measureRight - measureLeft);
      measureRangeRef.current = { left: measureLeft, width: measureWidth };
      setBbox({
        leftPx: measureLeft - scrollHost.scrollLeft,
        widthPx: measureWidth,
      });
      // Grayed left: 0 → waveform's left edge
      setTrainGrayLeftPx(focusLeftPx);
      // Grayed right: from the right edge of the last full-fit bar to the
      // viewport's right edge — also clamped to start no earlier than the
      // waveform's right edge so it shows any content that bleeds past.
      const rightEndX = measureXs[anchor + bars];
      const rightEndInViewport = rightEndX != null ? rightEndX - scrollHost.scrollLeft : focusRightPx;
      setTrainGrayRightStartPx(Math.min(rightEndInViewport, focusRightPx));
    }

    // Sticky preamble position — same math for both modes.
    // Karaoke: `spacerPx - scrollLeft` slides the preamble left until it
    // pins at 0 once the original preamble would have scrolled off.
    // Window: `scrollLeft` is large on pages 2+ (anchor > 0), so the max
    // clamp pins it at 0; on page 1 (anchor === 0) scrollLeft is 0, so
    // this evaluates to spacerPx — but page 1 doesn't render the sticky
    // anyway (the natural preamble is already visible).
    const spacerPx = viewport * 0.22;
    setStickyPreambleLeftPx(Math.max(0, spacerPx - scrollHost.scrollLeft));
  }, [
    position, audioOffset, scrollHost, timeline, measureXs, measureTimes,
    trackingMode, windowAnchor, resizeTick, playing,
  ]);

  // Latest-value refs so the scroll-host event handlers (attached once per
  // scrollHost) always see fresh `measureXs`, `measureTimes`, `trackingMode`,
  // and `engine` without needing to re-subscribe on every render.
  const measureXsRef = useRef(measureXs);
  const measureTimesRef = useRef(measureTimes);
  const trackingModeRef = useRef(trackingMode);
  const engineRef = useRef(engine);
  useEffect(() => { measureXsRef.current = measureXs; }, [measureXs]);
  useEffect(() => { measureTimesRef.current = measureTimes; }, [measureTimes]);
  useEffect(() => { trackingModeRef.current = trackingMode; }, [trackingMode]);
  useEffect(() => { engineRef.current = engine; }, [engine]);

  // Detect user scroll (wheel, trackpad, scrollbar drag, keyboard, touch).
  // We can't distinguish source, so we compare actual scrollLeft against
  // the last value we wrote programmatically. A mismatch > 1 px means the
  // user scrolled.
  //
  // While playing: enter the lock and record the "resume at" measure from
  // the current reading point so auto-scroll resumes once playback catches
  // up. The sync effect's locked branch handles viewport updates.
  //
  // While paused: the sync effect is keyed on `position` and won't re-run
  // for a scroll, so imperatively refresh the sticky preamble, playhead,
  // and bbox from `scrollLeft` + the mirrored content-space refs. No lock —
  // pause → play re-runs the sync effect and snaps back to the live position.
  useEffect(() => {
    if (!scrollHost) return;
    const onScroll = () => {
      const delta = Math.abs(scrollHost.scrollLeft - expectedScrollLeftRef.current);
      const isUserScroll = delta >= 1;
      if (isUserScroll && playingRef.current) {
        scrollLockedRef.current = true;
        const xs = measureXsRef.current;
        if (xs.length >= 2) {
          const contentX = scrollHost.scrollLeft + focusLeftPxRef.current;
          const m = findMeasureAtX(contentX, xs);
          resumeAtMeasureRef.current = m;
          if (trackingModeRef.current === 'window') lockedAnchorRef.current = m;
        }
      }
      if (!playingRef.current) {
        const viewport = scrollHost.clientWidth;
        const spacerPx = viewport * 0.22;
        setStickyPreambleLeftPx(Math.max(0, spacerPx - scrollHost.scrollLeft));
        setCursorPx(cursorContentXRef.current - scrollHost.scrollLeft);
        const range = measureRangeRef.current;
        if (range) {
          setBbox({
            leftPx: range.left - scrollHost.scrollLeft,
            widthPx: range.width,
          });
        }
      }
    };
    scrollHost.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollHost.removeEventListener('scroll', onScroll);
  }, [scrollHost]);

  // Click-to-jump: click anywhere inside the scroll host → seek to the
  // start (downbeat) of the clicked measure. Distinguishes click from drag
  // with a 4-px move threshold, mirroring LyricsDisplay's VerticalTrack so
  // a user-initiated scroll that ends with a release doesn't fire a seek.
  const CLICK_DRAG_THRESHOLD_PX = 4;
  useEffect(() => {
    if (!scrollHost) return;
    const onPointerDown = (e: PointerEvent) => {
      pointerDownXRef.current = e.clientX;
      draggingRef.current = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (pointerDownXRef.current === null) return;
      if (Math.abs(e.clientX - pointerDownXRef.current) > CLICK_DRAG_THRESHOLD_PX) {
        draggingRef.current = true;
      }
    };
    const onPointerUp = () => {
      if (draggingRef.current) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
      pointerDownXRef.current = null;
      draggingRef.current = false;
    };
    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) return;
      const xs = measureXsRef.current;
      const times = measureTimesRef.current;
      if (xs.length < 2 || times.length === 0) return;
      const hostRect = scrollHost.getBoundingClientRect();
      const contentX = (e.clientX - hostRect.left) + scrollHost.scrollLeft;
      const rawMIdx = findMeasureAtX(contentX, xs);
      const mIdx = Math.max(0, Math.min(rawMIdx, times.length - 1));
      engineRef.current?.seek(times[mIdx]);
    };
    scrollHost.addEventListener('pointerdown', onPointerDown);
    scrollHost.addEventListener('pointermove', onPointerMove);
    scrollHost.addEventListener('pointerup', onPointerUp);
    scrollHost.addEventListener('pointercancel', onPointerUp);
    scrollHost.addEventListener('click', onClick);
    return () => {
      scrollHost.removeEventListener('pointerdown', onPointerDown);
      scrollHost.removeEventListener('pointermove', onPointerMove);
      scrollHost.removeEventListener('pointerup', onPointerUp);
      scrollHost.removeEventListener('pointercancel', onPointerUp);
      scrollHost.removeEventListener('click', onClick);
    };
  }, [scrollHost]);

  if (!sheetMusicUrl) return null;

  // Loading-only placeholder height. Once the score is rendered the
  // scroll host auto-sizes to the SVG, so this only controls the
  // height of the "loading…" spinner area, not the final layout.
  const minRenderHeight = Math.max(80, 100 * scoreZoom);
  const PLAYHEAD_COLOR = '#22D3EE';

  // All overlay children use `top: 0; bottom: 0` so they stretch to the
  // wrapper's auto-sized height — the playhead line and bbox span the
  // full rendered score, however tall it ends up.
  const overlay = (
    <>
      {/* Playhead line — full-system height, toggleable */}
      {showPlayhead && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: cursorPx - 1, width: 2,
          background: PLAYHEAD_COLOR, opacity: 0.9,
          boxShadow: `0 0 6px rgba(34,211,238,0.6)`,
          pointerEvents: 'none', zIndex: 5,
        }} />
      )}
      {/* Window-mode bbox — spans the current measure */}
      {bbox && (
        <div style={{
          position: 'absolute', top: 4, bottom: 4,
          left: bbox.leftPx, width: bbox.widthPx,
          background: 'rgba(34,211,238,0.15)',
          borderRadius: 2, pointerEvents: 'none', zIndex: 4,
        }} />
      )}
      {/* Window-mode grayed prev-bar tail on the left */}
      {trainGrayLeftPx > 0 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: 0, width: trainGrayLeftPx,
          background: 'rgba(255,255,255,0.5)',
          borderRight: '1px dashed rgba(107,159,214,0.5)',
          pointerEvents: 'none', zIndex: 3,
        }} />
      )}
      {/* Window-mode grayed next-page region on the right */}
      {trainGrayRightStartPx != null && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: Math.max(0, trainGrayRightStartPx), right: 0,
          background: 'rgba(255,255,255,0.5)',
          borderLeft: '1px dashed rgba(107,159,214,0.5)',
          pointerEvents: 'none', zIndex: 3,
        }} />
      )}
      {/* Sticky preamble — a clipped clone of the rendered SVG's first
          `preambleWidth` pixels (clef + key sig + time sig). Opaque so
          it covers the original score when the two overlap.
          Karaoke: slides left with the scroll until it pins at left=0.
          Window: hidden on page 1 (the natural preamble is visible) and
          always pinned at left=0 on pages 2+ (same visual as karaoke
          when pinned). */}
      {preambleWidth > 0 && (trackingMode === 'karaoke' || (trackingMode === 'window' && windowAnchor > 0)) && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: stickyPreambleLeftPx, width: preambleWidth,
          overflow: 'hidden', pointerEvents: 'none', zIndex: 6,
          background: '#fff',
        }}>
          <div ref={setPreambleHost} style={{ position: 'absolute', top: 0, left: 0 }} />
        </div>
      )}
    </>
  );

  return (
    <div className="px-2 py-1 border-b border-gray-800">
      <div className="flex items-center gap-2 mb-1 text-xs">
        <div className="flex gap-1">
          <button
            onClick={() => setTrackingMode('karaoke')}
            className={`px-2 py-0.5 rounded ${trackingMode === 'karaoke' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          >karaoke</button>
          <button
            onClick={() => setTrackingMode('window')}
            className={`px-2 py-0.5 rounded ${trackingMode === 'window' ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          >window</button>
        </div>
        <label className="flex items-center gap-1 text-gray-400">
          zoom
          <input
            type="range"
            min={0.6} max={1.5} step={0.05}
            value={scoreZoom}
            onChange={(e) => setScoreZoom(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="tabular-nums w-10 text-right">{(scoreZoom * 100).toFixed(0)}%</span>
        </label>
        <button
          onClick={() => setEqualBeatWidthOverride(effectiveEqualBeatWidth ? false : true)}
          className={`px-2 py-0.5 rounded ${effectiveEqualBeatWidth ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          title="Toggle between OSMD's natural beat-width layout and equal-beat-width"
        >{effectiveEqualBeatWidth ? 'equal-beat' : 'natural'}</button>
        <button
          onClick={() => setShowPlayhead(!showPlayhead)}
          className={`px-2 py-0.5 rounded ${showPlayhead ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
          title="Show or hide the playhead line"
        >playhead</button>
        {parts.length > 0 && (
          <div ref={partsMenuRef} className="relative">
            <button
              onClick={() => setPartsMenuOpen((v) => !v)}
              className={`px-2 py-0.5 rounded ${hiddenPartIds.size > 0 ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-300'}`}
              title="Pick which instrument parts to display"
            >
              parts ({parts.length - hiddenPartIds.size}/{parts.length})
            </button>
            {partsMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded border border-gray-700 bg-gray-900 p-1 shadow-lg"
                role="menu"
              >
                {parts.map((p) => {
                  const on = !draftHiddenPartIds.has(p.id);
                  const isLastVisible = on && parts.length - draftHiddenPartIds.size <= 1;
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-gray-200 ${isLastVisible ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-800'}`}
                      title={isLastVisible ? 'At least one part must stay visible' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={isLastVisible}
                        onChange={() => toggleDraftPart(p.id)}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  );
                })}
                <div className="mt-1 border-t border-gray-700 pt-1">
                  <button
                    onClick={applyPartsDraft}
                    disabled={!draftDiffers}
                    className={`w-full rounded px-2 py-1 text-xs ${draftDiffers ? 'bg-cyan-700 text-white hover:bg-cyan-600' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                  >
                    apply
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div ref={rendererWrapperRef} style={{ position: 'relative' }}>
        <InfiniteScoreRenderer
          url={sheetMusicUrl}
          height={minRenderHeight}
          zoom={scoreZoom}
          equalBeatWidth={effectiveEqualBeatWidth}
          leadingPadFraction={0.22}
          onReady={handleReady}
          onTimeline={handleTimeline}
          onMeasureXs={handleMeasureXs}
          onSvgReady={handleSvgReady}
          onParts={handleParts}
          visiblePartIds={visiblePartIds}
        />
        {/* Overlay — sibling of the scroll host (NOT inside it) so the
            playhead stays fixed to the viewport instead of scrolling with
            the score content. `inset: 0` stretches it to the wrapper's
            auto-sized height so the playhead line + bbox span the full
            rendered score, no matter how many staves it has. */}
        <div style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}>
          {overlay}
        </div>
      </div>
    </div>
  );
}

/**
 * Binary search `measureXs` for the measure that contains content-x `x`:
 * the largest index `i` where `measureXs[i] <= x`. Clamped to valid measure
 * indices — preamble clicks (x before the first barline) map to 0; trailing
 * clicks (x past the last barline) map to the last measure.
 *
 * `measureXs` has length `numMeasures + 1` — the final entry is the
 * end-of-last-measure, so valid start-indices are `[0, length - 2]`.
 */
function findMeasureAtX(x: number, measureXs: number[]): number {
  if (measureXs.length < 2) return 0;
  const lastStart = measureXs.length - 2;
  if (x <= measureXs[0]) return 0;
  if (x >= measureXs[lastStart]) return lastStart;
  let lo = 0;
  let hi = lastStart;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (measureXs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * How many measures starting at `anchor` fully fit inside `usablePx`?
 * A measure fits if its right barline is within `usablePx` of its left.
 * The first measure that doesn't fully fit becomes the anchor of the next
 * page — it is **not** included in this page. Always returns at least 1
 * so pathologically narrow viewports still render something.
 */
function barsFittingFromAnchor(
  anchor: number,
  usablePx: number,
  measureXs: number[],
): number {
  if (measureXs.length < 2 || anchor >= measureXs.length - 1) return 1;
  const anchorX = measureXs[anchor];
  const available = Math.max(1, usablePx);
  let fits = 0;
  for (let n = 1; anchor + n < measureXs.length; n++) {
    const rightX = measureXs[anchor + n];
    if (rightX - anchorX > available) break;
    fits = n;
  }
  const remaining = measureXs.length - 1 - anchor;
  return Math.max(1, Math.min(fits, remaining));
}
