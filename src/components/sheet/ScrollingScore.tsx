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
import type { UnfoldedStep } from '../../audio/unfoldRepeats';

/** Pixels to nudge the left focus point right of the waveform's left edge.
 *  Keep in sync with the same constant in `LyricsDisplay.tsx` so the
 *  lyric reading point, karaoke playhead, and window-mode first bar all
 *  line up vertically. */
const FOCUS_LEFT_NUDGE_PX = 24;

/** Pixels to extend the window-mode right boundary beyond the waveform's
 *  right edge. Only affects window mode; karaoke doesn't use the right
 *  boundary. Clamped to the scroll-host viewport. */
const FOCUS_RIGHT_NUDGE_PX = 32;

/** Fixed leading pad (px) reserved inside the scroll host before the
 *  first note. Must match the `leadingPadPx` prop passed to
 *  `InfiniteScoreRenderer`. Using a viewport fraction would shrink on
 *  resize and shift every cached `measureXs` value — so every measure
 *  in the score is a fixed px constant. */
const LEADING_PAD_PX = 180;

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
  /** Unfolded playback order derived from the MusicXML's repeat / jump
   *  markers. Maps the "audio-side" unfolded index `u` → the written
   *  measure `srcIndex` we should use to look up an x-pixel in `measureXs`.
   *  Empty array when the score has no repeats (or the parser failed) —
   *  in that case callers fall back to `srcIdx = u`. */
  const [unfolded, setUnfolded] = useState<UnfoldedStep[]>([]);
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
  /** Last `resizeTick` value the sync effect acted on. Used to detect a
   *  viewport reflow and release the scroll lock — the user's "intentional
   *  scroll position" is measured in pixels on a specific layout, so it
   *  no longer applies after a resize. Without this, a manual scroll
   *  mid-playback freezes the playhead / bbox in their pre-resize
   *  viewport coordinates even after the window changes size. */
  const lastResizeTickRef = useRef(0);
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
  /** Gear-panel open state + click-outside container ref. */
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
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
  const handleUnfoldedOrder = useCallback((steps: UnfoldedStep[]) => setUnfolded(steps), []);
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
    const spacerPx = LEADING_PAD_PX;
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
    setUnfolded([]);
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

  // Close the settings (gear) dropdown when clicking outside it.
  // Same pattern as the parts menu — independent state + ref so both can
  // close on their own outside-click without interfering with each other.
  useEffect(() => {
    if (!settingsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = settingsMenuRef.current;
      if (el && !el.contains(e.target as Node)) setSettingsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsMenuOpen]);

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
  //
  // Three triggers: a ResizeObserver on scrollHost + the waveform (catches
  // element-level reflows), a window `resize` listener (catches viewport
  // reflows that don't change the observed elements' box sizes — some
  // browsers don't re-fire RO on those), and an `orientationchange` for
  // mobile rotation. Without the window listener, paused playback after
  // a resize leaves the playhead and bbox stuck at their old viewport
  // coords because the sync effect is keyed on `resizeTick`.
  useEffect(() => {
    if (!scrollHost) return;
    let waveformEl: Element | null = null;
    const bump = () => {
      // Re-query the waveform on every bump so if it re-mounts we pick
      // up the new element (and re-observe it below).
      const fresh = document.querySelector('[data-waveform-timeline]');
      if (fresh && fresh !== waveformEl) {
        if (waveformEl) ro.unobserve(waveformEl);
        ro.observe(fresh);
        waveformEl = fresh;
      }
      setResizeTick((n) => n + 1);
    };
    const ro = new ResizeObserver(bump);
    ro.observe(scrollHost);
    bump();
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
    };
  }, [scrollHost]);

  // Sync effect — runs on every transport position update via the Zustand
  // subscription. This is the same pattern LyricsDisplay uses: no RAF loop,
  // just re-derive state when `position` changes.
  useEffect(() => {
    if (!scrollHost || timeline.length === 0 || measureXs.length < 2) return;

    const t = position - audioOffset;

    // `mIdx` is the UNFOLDED measure index — `measureTimes` comes from the
    // tapMap, which is keyed to the unfolded audio (one entry per audible
    // downbeat), so `currentMeasureIndex` returns `u` directly.
    //
    // For x-pixel math, resolve `u` through the unfold table to get
    // the matching WRITTEN measure index (`srcIdx`). On scores without
    // repeats `unfolded` is empty and `srcIdx === u`, which is the
    // pre-existing behavior.
    let mIdx = 0;
    let srcIdx = 0;
    let srcIdxNext = 0;
    let cursorContentX: number;
    if (measureTimes.length >= 2) {
      mIdx = currentMeasureIndex(t + audioOffset, measureTimes);
      const step = unfolded.length > 0 ? unfolded[mIdx] : undefined;
      srcIdx = step?.srcIndex ?? mIdx;
      const nextStep = unfolded.length > 0 ? unfolded[mIdx + 1] : undefined;
      srcIdxNext = nextStep?.srcIndex ?? (mIdx + 1);
      const t0 = measureTimes[mIdx];
      const t1 = measureTimes[mIdx + 1] ?? t0 + 1;
      const frac = Math.max(0, Math.min(1, (t + audioOffset - t0) / Math.max(0.001, t1 - t0)));
      const x0 = measureXs[srcIdx] ?? 0;
      // If the next unfolded measure is a jump target (repeat back,
      // D.C., D.S., coda, or volta skip), don't lerp across the gap —
      // that would slide the playhead visibly backward or forward
      // through the current bar. Instead, lerp to the END of the
      // current written measure; the snap to the jump destination
      // happens discontinuously at the next measure onset.
      const isJump = srcIdxNext !== srcIdx + 1;
      const x1 = isJump
        ? (measureXs[srcIdx + 1] ?? x0)
        : (measureXs[srcIdxNext] ?? x0);
      cursorContentX = x0 + frac * (x1 - x0);
    } else {
      // No tapMap measures: fall back to the first measure's x and freeze
      cursorContentX = measureXs[0] ?? 0;
    }

    cursorContentXRef.current = cursorContentX;

    // A viewport reflow (browser resize / rotate / layout shift) breaks
    // the user's "intentional scroll position" — whatever pixel offset
    // they scrolled to no longer anchors the same measure. Clear the
    // lock so the non-locked branch below re-centers on the live
    // playhead against the new waveform edges.
    if (lastResizeTickRef.current !== resizeTick) {
      lastResizeTickRef.current = resizeTick;
      scrollLockedRef.current = false;
      resumeAtMeasureRef.current = -1;
    }

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
    let focusLeftPx = LEADING_PAD_PX;
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
      //
      // Indexing: `anchor`, `bars`, and `mIdx` are all in UNFOLDED space.
      // `measureXs` lookups convert through the unfold table so a repeat
      // revisits the same on-screen measure when the audio loops.
      const usableWidth = Math.max(1, focusRightPx - focusLeftPx);

      let anchor = locked ? lockedAnchorRef.current : windowAnchor;
      let bars = barsFittingFromAnchor(anchor, usableWidth, measureXs, unfolded);

      if (!locked) {
        if (mIdx < anchor) {
          // Seek backward — jump to a page that starts at mIdx
          anchor = mIdx;
          bars = barsFittingFromAnchor(anchor, usableWidth, measureXs, unfolded);
          setWindowAnchor(anchor);
        } else if (mIdx >= anchor + bars) {
          // Forward progress — walk page-by-page because each page has its
          // own bars-count (real measures vary in rendered width)
          let safety = 200;
          const totalLen = unfolded.length > 0 ? unfolded.length : measureXs.length - 1;
          while (mIdx >= anchor + bars && safety-- > 0 && anchor + bars < totalLen) {
            anchor = anchor + bars;
            bars = barsFittingFromAnchor(anchor, usableWidth, measureXs, unfolded);
          }
          setWindowAnchor(anchor);
        }
      }

      const srcAnchor = unfolded.length > 0 ? (unfolded[anchor]?.srcIndex ?? anchor) : anchor;
      const srcAnchorEnd = unfolded.length > 0
        ? (unfolded[anchor + bars]?.srcIndex ?? (srcAnchor + bars))
        : (anchor + bars);
      const anchorX = measureXs[srcAnchor] ?? 0;
      if (!locked) {
        // Scroll so the first bar's barline sits at the waveform's left edge
        const nextScrollLeft = Math.max(0, anchorX - focusLeftPx);
        expectedScrollLeftRef.current = nextScrollLeft;
        scrollHost.scrollLeft = nextScrollLeft;
      }
      setCursorPx(cursorContentX - scrollHost.scrollLeft);
      // Bbox spans the current written measure (snappiness: measure,
      // anchor: start). Always uses `srcIdx + 1` for the right edge
      // rather than `srcIdxNext` — on a jump those disagree and the
      // bbox would collapse or invert.
      const measureLeft = measureXs[srcIdx] ?? cursorContentX;
      const measureRight = measureXs[srcIdx + 1] ?? (measureLeft + 120);
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
      const rightEndX = measureXs[srcAnchorEnd];
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
    setStickyPreambleLeftPx(Math.max(0, LEADING_PAD_PX - scrollHost.scrollLeft));
  }, [
    position, audioOffset, scrollHost, timeline, measureXs, measureTimes,
    trackingMode, windowAnchor, resizeTick, playing, unfolded,
  ]);

  // Latest-value refs so the scroll-host event handlers (attached once per
  // scrollHost) always see fresh `measureXs`, `measureTimes`, `trackingMode`,
  // and `engine` without needing to re-subscribe on every render.
  const measureXsRef = useRef(measureXs);
  const measureTimesRef = useRef(measureTimes);
  const unfoldedRef = useRef(unfolded);
  const trackingModeRef = useRef(trackingMode);
  const engineRef = useRef(engine);
  useEffect(() => { unfoldedRef.current = unfolded; }, [unfolded]);
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
          const writtenIdx = findMeasureAtX(contentX, xs);
          // resumeAtMeasureRef and lockedAnchorRef are compared against
          // `mIdx` (UNFOLDED index) in the sync effect, so convert the
          // clicked WRITTEN measure to its first unfolded occurrence.
          const uf = unfoldedRef.current;
          let unfoldedIdx = writtenIdx;
          if (uf.length > 0) {
            const first = uf.findIndex((s) => s.srcIndex === writtenIdx);
            if (first >= 0) unfoldedIdx = first;
          }
          resumeAtMeasureRef.current = unfoldedIdx;
          if (trackingModeRef.current === 'window') lockedAnchorRef.current = unfoldedIdx;
        }
      }
      if (!playingRef.current) {
        setStickyPreambleLeftPx(Math.max(0, LEADING_PAD_PX - scrollHost.scrollLeft));
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
      const uf = unfoldedRef.current;
      if (xs.length < 2 || times.length === 0) return;
      const hostRect = scrollHost.getBoundingClientRect();
      const contentX = (e.clientX - hostRect.left) + scrollHost.scrollLeft;
      const writtenIdx = findMeasureAtX(contentX, xs);
      // `findMeasureAtX` returns a WRITTEN measure index. `times` is
      // keyed in UNFOLDED order (one entry per audible downbeat), so we
      // need to resolve the click to the first unfolded occurrence of
      // that written measure — otherwise clicking m.9 on a score with
      // repeats seeks to the 9th *unfolded* measure, which is usually
      // not m.9 at all.
      let unfoldedIdx = writtenIdx;
      if (uf.length > 0) {
        const first = uf.findIndex((s) => s.srcIndex === writtenIdx);
        if (first >= 0) unfoldedIdx = first;
      }
      const mIdx = Math.max(0, Math.min(unfoldedIdx, times.length - 1));
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
    <div className="relative border-b border-gray-800">
      {/* Gear + parts triggers — absolutely positioned in the top-right so
          the score renders flush with the top of the panel. Both triggers
          live in the same row-flex wrapper, anchored together. The
          wrapper itself sits above the score (z-index) and does NOT
          scroll with it — it's a sibling of the scroll host, not a
          child. */}
        <div className="absolute top-1 right-1 z-20 flex items-center gap-1 text-xs">
          {parts.length > 0 && (
            <div ref={partsMenuRef} className="relative">
              <button
                onClick={() => setPartsMenuOpen((v) => !v)}
                className={`px-2 py-0.5 rounded ${hiddenPartIds.size > 0 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                title="Pick which instrument parts to display"
              >
                parts ({parts.length - hiddenPartIds.size}/{parts.length})
              </button>
              {partsMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded border border-gray-700 bg-gray-900 p-1 shadow-lg"
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
                      className={`w-full rounded px-2 py-1 text-xs ${draftDiffers ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                      title="Apply the part selection and redraw the score"
                    >
                      apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={settingsMenuRef} className="relative">
            <button
              onClick={() => setSettingsMenuOpen((v) => !v)}
              className="flex items-center justify-center rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              title="Sheet music settings"
              aria-label="Sheet music settings"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {settingsMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 w-56 rounded border border-gray-700 bg-gray-900 p-2 shadow-lg text-gray-200"
                role="menu"
              >
                {/* Tracking mode */}
                <div className="mb-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Tracking mode</div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTrackingMode('karaoke')}
                      className={`flex-1 px-2 py-0.5 rounded ${trackingMode === 'karaoke' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Score scrolls smoothly under a fixed playback cursor"
                    >continuous</button>
                    <button
                      onClick={() => setTrackingMode('window')}
                      className={`flex-1 px-2 py-0.5 rounded ${trackingMode === 'window' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Show a page of measures at a time; advance when filled"
                    >windowed</button>
                  </div>
                </div>

                {/* Spacing */}
                <div className="mb-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Spacing</div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEqualBeatWidthOverride(false)}
                      className={`flex-1 px-2 py-0.5 rounded ${!effectiveEqualBeatWidth ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Space measures based on how many notes they contain"
                    >natural</button>
                    <button
                      onClick={() => setEqualBeatWidthOverride(true)}
                      className={`flex-1 px-2 py-0.5 rounded ${effectiveEqualBeatWidth ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Make every measure the same width"
                    >equal-beat</button>
                  </div>
                </div>

                {/* Playhead */}
                <div className="mb-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Playhead</div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setShowPlayhead(true)}
                      className={`flex-1 px-2 py-0.5 rounded ${showPlayhead ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Show the vertical line marking current playback"
                    >show</button>
                    <button
                      onClick={() => setShowPlayhead(false)}
                      className={`flex-1 px-2 py-0.5 rounded ${!showPlayhead ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                      title="Hide the vertical line marking current playback"
                    >hide</button>
                  </div>
                </div>

                {/* Zoom */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>Zoom</span>
                    <span className="tabular-nums text-gray-300">{(scoreZoom * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.6}
                    max={1.5}
                    step={0.05}
                    value={scoreZoom}
                    onChange={(e) => setScoreZoom(parseFloat(e.target.value))}
                    className="w-full"
                    title="Scale the score"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      <div ref={rendererWrapperRef} style={{ position: 'relative' }}>
        <InfiniteScoreRenderer
          url={sheetMusicUrl}
          height={minRenderHeight}
          zoom={scoreZoom}
          equalBeatWidth={effectiveEqualBeatWidth}
          leadingPadPx={LEADING_PAD_PX}
          onReady={handleReady}
          onTimeline={handleTimeline}
          onMeasureXs={handleMeasureXs}
          onSvgReady={handleSvgReady}
          onParts={handleParts}
          onUnfoldedOrder={handleUnfoldedOrder}
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
 *
 * `anchor` is indexed in UNFOLDED space when `unfolded` is non-empty;
 * otherwise it's a written-measure index (back-compat). Width for each
 * step is derived from the written-measure x-pixels by translating each
 * unfolded step's `srcIndex` through `measureXs`.
 */
function barsFittingFromAnchor(
  anchor: number,
  usablePx: number,
  measureXs: number[],
  unfolded: UnfoldedStep[],
): number {
  if (measureXs.length < 2) return 1;
  const useUnfold = unfolded.length > 0;
  const total = useUnfold ? unfolded.length : measureXs.length - 1;
  if (anchor >= total) return 1;
  const srcAt = (u: number): number => useUnfold
    ? (unfolded[u]?.srcIndex ?? u)
    : u;
  const anchorX = measureXs[srcAt(anchor)] ?? 0;
  const available = Math.max(1, usablePx);
  let fits = 0;
  for (let n = 1; anchor + n <= total; n++) {
    const srcNext = srcAt(anchor + n);
    const rightX = measureXs[srcNext];
    if (rightX == null) break;
    if (rightX - anchorX > available) break;
    fits = n;
  }
  const remaining = total - anchor;
  return Math.max(1, Math.min(fits, remaining));
}
