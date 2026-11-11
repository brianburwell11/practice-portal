import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { drawPeaks } from './drawPeaks';
import { useTransportStore } from '../../store/transportStore';
import { useSongStore } from '../../store/songStore';
import { useLyricsEditorStore } from '../../store/lyricsEditorStore';
import { useChordsEditorStore } from '../../store/chordsEditorStore';
import { beatGrid, lastAtOrBefore, snapTime } from '../../audio/chordGrid';
import { displayChord } from '../../audio/chordSymbols';
import { useMarkerEditorStore } from '../../store/markerEditorStore';
import type { TapMapEntry } from '../../audio/types';
import { markersToSeconds } from '../../audio/tempoUtils';
import { autoLabelSection, findEnclosingSectionIndex, getSectionRange } from '../../audio/tapMapUtils';
import { useNotesStore, NOTE_COLOR } from '../../store/notesStore';
import { useNotePermissions } from '../../hooks/useNotePermissions';

/** Detect coarse pointer (touch device) */
const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Snap threshold in pixels — how close the cursor must be to a marker to snap. */
const SNAP_PX = isCoarse ? 24 : 12;
/** Loop marker hit test threshold in pixels */
const HIT_PX = isCoarse ? 20 : 6;
/** Most a plain beat pulls a loop edge, in pixels: gentler than bars and sections. */
const BEAT_SNAP_PX = isCoarse ? 12 : 7;
/** Minimum zoom level in seconds */
/** Chord markers in the chords editor: pink, apart from lyric cyan, section gold and loop yellow. */
const CHORD_MARKER_COLOR = '#f472b6';

const MIN_VIEW = 5;
/** How long a finger must rest on the waveform before a drag selects a loop instead of panning. */
const LONG_PRESS_MS = 450;
/** Default zoom level in seconds for mobile */
const DEFAULT_MOBILE_VIEW = 30;
/** Default zoom level in seconds for desktop (songs > 2.5 min start zoomed) */
const DEFAULT_DESKTOP_VIEW = 150;

interface WaveformTimelineProps {
  /**
   * A short waveform for a docked transport (the full-screen score). It isn't
   * marked as *the* waveform: notes, lyrics and the scrolling score line up on
   * the main one, found by `data-waveform-timeline`.
   */
  compact?: boolean;
}

export function WaveformTimeline({ compact = false }: WaveformTimelineProps = {}) {
  const engine = useAudioEngine();
  const { position, duration, loopA, loopB, loopEnabled, followPlayhead, setFollowPlayhead, peaksVersion } = useTransportStore();
  const selectedSong = useSongStore((s) => s.selectedSong);
  const lyricsEditorOpen = useLyricsEditorStore((s) => s.isOpen);
  const lyricsLines = useLyricsEditorStore((s) => s.lines);
  const moveLyricLine = useLyricsEditorStore((s) => s.moveLine);
  const chordsEditorOpen = useChordsEditorStore((s) => s.isOpen);
  const editorChords = useChordsEditorStore((s) => s.chords);
  const chordSnap = useChordsEditorStore((s) => s.snap);
  const notes = useNotesStore((s) => s.notes);
  const setNoteTime = useNotesStore((s) => s.setTime);
  // Dragging a note's dot retimes it: your own notes, or anyone's for a Manager or the Owner.
  const { canEdit: canEditNote } = useNotePermissions();

  // TapMap editor integration \u2014 when the editor is open the timeline
  // sources its tapMap from the editor store (live, dirty copy) and
  // supports select-and-drag on entries. Outside the editor it reads
  // the song's saved tapMap as before.
  const markerEditorOpen = useMarkerEditorStore((s) => s.isOpen);
  const editorTapMap = useMarkerEditorStore((s) => s.tapMap);
  const markerSelectedIndex = useMarkerEditorStore((s) => s.selectedIndex);
  const setMarkerSelectedIndex = useMarkerEditorStore((s) => s.setSelectedIndex);
  const moveMarkerEntry = useMarkerEditorStore((s) => s.moveEntry);
  const updateMarkerEntryType = useMarkerEditorStore((s) => s.updateEntryType);
  const deleteMarkerEntriesWhere = useMarkerEditorStore((s) => s.deleteEntriesWhere);
  const displayTapMap: TapMapEntry[] | undefined = markerEditorOpen
    ? editorTapMap
    : selectedSong?.tapMap;

  // Main canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [canvasReady, setCanvasReady] = useState(false);

  // Overview canvas refs
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const overviewContainerRef = useRef<HTMLDivElement>(null);
  const overviewSizeRef = useRef({ width: 0, height: 0 });

  // Viewport state — mobile starts zoomed to ~10s, desktop fully zoomed out
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(isCoarse ? DEFAULT_MOBILE_VIEW : DEFAULT_DESKTOP_VIEW);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [draggingMarker, setDraggingMarker] = useState<'A' | 'B' | null>(null);
  const suppressClickRef = useRef(false);

  // Pinch-to-zoom state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; viewDuration: number; centerX: number } | null>(null);

  // Single-finger drag-to-pan state
  const dragStartRef = useRef<{ x: number; viewStart: number } | null>(null);
  const didDragRef = useRef(false);
  const DRAG_THRESHOLD = 8;

  // Drag across an empty stretch of waveform to set a loop. With a mouse
  // it's a plain drag (Alt/Option-drag still pans); on touch it's press,
  // hold, then drag, so a one-finger drag still pans. `active` once the
  // selection has started; until then it may still turn into a click,
  // a pan or a pinch. Committed on release, so a slip can't clobber the
  // current loop mid-drag.
  const loopSelectRef = useRef<{ anchor: number; current: number; startX: number; active: boolean } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const [loopSelecting, setLoopSelecting] = useState(false);
  const [loopSelectTick, setLoopSelectTick] = useState(0);
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);
  const cancelLoopSelect = useCallback(() => {
    cancelLongPress();
    if (!loopSelectRef.current) return;
    loopSelectRef.current = null;
    setLoopSelecting(false);
    setLoopSelectTick((n) => n + 1);
  }, [cancelLongPress]);
  useEffect(() => cancelLongPress, [cancelLongPress]);

  const effectiveViewDuration = Math.min(viewDuration, duration || Infinity);
  const isZoomed = duration > 0 && effectiveViewDuration < duration;

  // Clamp viewStart helper
  const clampViewStart = useCallback(
    (vs: number, vd: number) => {
      if (!duration) return 0;
      return Math.max(0, Math.min(duration - vd, vs));
    },
    [duration],
  );

  // Reset zoom when song changes
  useEffect(() => {
    setViewStart(0);
    setViewDuration(isCoarse ? DEFAULT_MOBILE_VIEW : DEFAULT_DESKTOP_VIEW);
  }, [selectedSong?.id]);

  // Viewport coordinate helpers
  const secondsToPixel = useCallback(
    (seconds: number, width: number) => ((seconds - viewStart) / effectiveViewDuration) * width,
    [viewStart, effectiveViewDuration],
  );

  const pixelToSeconds = useCallback(
    (px: number, width: number) => viewStart + (px / width) * effectiveViewDuration,
    [viewStart, effectiveViewDuration],
  );

  // Find nearest snappable marker (section or measure) near a pixel X
  const findSnapMarker = useCallback(
    (pixelX: number): number | null => {
      if (!duration || !selectedSong) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;

      const tapMap = displayTapMap;
      if (tapMap && tapMap.length > 0) {
        let closest: { time: number; dist: number } | null = null;
        for (const entry of tapMap as TapMapEntry[]) {
          if (entry.type === 'beat') continue;
          const markerX = secondsToPixel(entry.time, width);
          const dist = Math.abs(pixelX - markerX);
          if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
            closest = { time: entry.time, dist };
          }
        }
        return closest?.time ?? null;
      }

      const markers = markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset);
      let closest: { time: number; dist: number } | null = null;
      for (const marker of markers) {
        const markerX = secondsToPixel(marker.seconds, width);
        const dist = Math.abs(pixelX - markerX);
        if (dist <= SNAP_PX && (!closest || dist < closest.dist)) {
          closest = { time: marker.seconds, dist };
        }
      }
      return closest?.time ?? null;
    },
    [duration, selectedSong, displayTapMap, secondsToPixel],
  );

  // Hit test: check if a pixel X is within threshold of loop A or B marker
  const hitTestLoopMarker = useCallback(
    (pixelX: number): 'A' | 'B' | null => {
      if (loopA === null || loopB === null) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      const ax = secondsToPixel(loopA, width);
      const bx = secondsToPixel(loopB, width);
      const distA = Math.abs(pixelX - ax);
      const distB = Math.abs(pixelX - bx);
      if (distA <= HIT_PX && distB <= HIT_PX) return distA <= distB ? 'A' : 'B';
      if (distA <= HIT_PX) return 'A';
      if (distB <= HIT_PX) return 'B';
      return null;
    },
    [loopA, loopB, secondsToPixel],
  );

  // Lyric marker drag state
  /** A lyric marker under the pointer: `moved` once it's dragged past a
   *  few pixels, so a plain click seeks instead of re-saving the time. */
  const dragLyricRef = useRef<{ index: number; time: number; startX: number; moved: boolean } | null>(null);
  /** A chord marker under the pointer (chords editor): its original time,
   *  where it's being dragged to, and `moved` past the click threshold. */
  const dragChordRef = useRef<{ from: number; symbol: string; time: number; startX: number; moved: boolean } | null>(null);
  const [chordDragTick, setChordDragTick] = useState(0);
  // TapMap editor entry drag state \u2014 mirrors the lyric-marker pattern.
  // `moved` once it's dragged past the click threshold; `editorDragTick`
  // bumps on each move so the canvas redraws the line under the pointer.
  const dragEditorEntryRef = useRef<{ index: number; time: number; startX: number; moved: boolean } | null>(null);
  const [editorDragTick, setEditorDragTick] = useState(0);
  // Note marker drag state — held in a ref for high-frequency updates;
  // `noteDragTick` bumps on each move so the canvas redraws. `editable`:
  // whether a drag may retime it (otherwise a click only seeks).
  const dragNoteRef = useRef<{ id: string; time: number; startX: number; moved: boolean; editable: boolean } | null>(null);
  const [noteDragTick, setNoteDragTick] = useState(0);
  const [hoveredNote, setHoveredNote] = useState<{ id: string } | null>(null);

  // Hit-test tapMap entries when the editor is active. Threshold
  // matches HIT_PX (same as loop/lyric markers) so behavior is
  // consistent across editable elements on the timeline.
  const hitTestEditorEntry = useCallback(
    (pixelX: number): number | null => {
      if (!markerEditorOpen || editorTapMap.length === 0) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      let closest: { index: number; dist: number } | null = null;
      for (let i = 0; i < editorTapMap.length; i++) {
        const t = dragEditorEntryRef.current?.index === i
          ? dragEditorEntryRef.current.time
          : editorTapMap[i].time;
        const mx = secondsToPixel(t, width);
        const dist = Math.abs(pixelX - mx);
        if (dist <= HIT_PX && (!closest || dist < closest.dist)) {
          closest = { index: i, dist };
        }
      }
      return closest?.index ?? null;
    },
    [markerEditorOpen, editorTapMap, secondsToPixel],
  );

  // Hit-test note markers. Note dots live at
  // (x, height-4) so we require both a small horizontal AND vertical
  // proximity — clicks higher up in the canvas (over the waveform)
  // shouldn't catch a note. Uses live drag time for the dragging note
  // so its dot stays hittable mid-drag.
  const hitTestNote = useCallback(
    (pixelX: number, pixelY: number): { id: string } | null => {
      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return null;
      if (Math.abs(pixelY - (height - 4)) > 14) return null;
      let closestId: string | null = null;
      let closestDist = Infinity;
      for (const note of notes) {
        const t = dragNoteRef.current?.id === note.id ? dragNoteRef.current.time : note.time;
        const mx = secondsToPixel(t, width);
        const dist = Math.abs(pixelX - mx);
        if (dist <= 8 && dist < closestDist) {
          closestId = note.id;
          closestDist = dist;
        }
      }
      return closestId !== null ? { id: closestId } : null;
    },
    [notes, secondsToPixel],
  );

  const hitTestLyricMarker = useCallback(
    (pixelX: number): number | null => {
      if (!lyricsEditorOpen || !lyricsLines.length) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      let closest: { index: number; dist: number } | null = null;
      for (let i = 0; i < lyricsLines.length; i++) {
        const t = lyricsLines[i].time;
        if (t === null) continue;
        const mx = secondsToPixel(t, width);
        const dist = Math.abs(pixelX - mx);
        if (dist <= HIT_PX && (!closest || dist < closest.dist)) {
          closest = { index: i, dist };
        }
      }
      return closest?.index ?? null;
    },
    [lyricsEditorOpen, lyricsLines, secondsToPixel],
  );

  const hitTestChordMarker = useCallback(
    (pixelX: number): number | null => {
      if (!chordsEditorOpen || !editorChords.length) return null;
      const { width } = sizeRef.current;
      if (width === 0) return null;
      let closest: { index: number; dist: number } | null = null;
      for (let i = 0; i < editorChords.length; i++) {
        const dist = Math.abs(pixelX - secondsToPixel(editorChords[i].time, width));
        if (dist <= HIT_PX && (!closest || dist < closest.dist)) closest = { index: i, dist };
      }
      return closest?.index ?? null;
    },
    [chordsEditorOpen, editorChords, secondsToPixel],
  );

  // The beat grid chord drags snap to (the editor's snap setting; never in free time).
  const chordGrid = useMemo(
    () => (chordsEditorOpen ? beatGrid(selectedSong?.tapMap, selectedSong?.timeSignatureMap) : []),
    [chordsEditorOpen, selectedSong?.tapMap, selectedSong?.timeSignatureMap],
  );

  // Every beat of a tapped song, for loop-selection snapping. Songs without
  // a tapMap have no trustworthy beats, so they only snap to their markers.
  const loopSnapGrid = useMemo(
    () => (displayTapMap?.length ? beatGrid(displayTapMap, selectedSong?.timeSignatureMap) : []),
    [displayTapMap, selectedSong?.timeSignatureMap],
  );

  /**
   * Where a loop edge dragged to pixel `x` lands. Bar lines and sections
   * pull from SNAP_PX away; plain beats pull more gently, and never from
   * more than a third of the way to the next beat, so there's always room
   * between beats to let go off the grid. Each line pulls in proportion to
   * its reach, so a beat right under the pointer beats a bar a few pixels
   * off. `free` (Alt/Option held mid-drag) turns snapping off.
   */
  const snapLoopEdge = useCallback(
    (x: number, free: boolean): { time: number; snapped: boolean } => {
      const { width } = sizeRef.current;
      const raw = Math.max(0, Math.min(pixelToSeconds(x, width), duration || 0));
      if (free || width === 0) return { time: raw, snapped: false };

      let best: { time: number; score: number } | null = null;
      const consider = (time: number, reach: number) => {
        if (reach <= 0) return;
        const score = Math.abs(secondsToPixel(time, width) - x) / reach;
        if (score <= 1 && (!best || score < best.score)) best = { time, score };
      };

      const grid = loopSnapGrid;
      if (grid.length > 0) {
        const i = Math.max(0, lastAtOrBefore(grid, raw));
        for (let j = Math.max(0, i - 2); j <= Math.min(grid.length - 1, i + 3); j++) {
          const line = grid[j];
          if (line.bar || line.label) {
            consider(line.time, SNAP_PX);
          } else {
            const prev = grid[j - 1]?.time ?? -Infinity;
            const next = grid[j + 1]?.time ?? Infinity;
            const gapPx = (Math.min(line.time - prev, next - line.time) / effectiveViewDuration) * width;
            consider(line.time, Math.min(BEAT_SNAP_PX, gapPx / 3));
          }
        }
      } else {
        const marker = findSnapMarker(x);
        if (marker !== null) consider(marker, SNAP_PX);
      }

      const hit = best as { time: number; score: number } | null;
      return hit ? { time: hit.time, snapped: true } : { time: raw, snapped: false };
    },
    [duration, pixelToSeconds, secondsToPixel, loopSnapGrid, effectiveViewDuration, findSnapMarker],
  );

  const [cursorStyle, setCursorStyle] = useState<string>('pointer');

  // Right-click context menu for changing a tapMap entry's type. Only
  // active while the marker editor is open. Position is in container-
  // relative pixels so the popup stays pinned to the waveform.
  const [markerContextMenu, setMarkerContextMenu] = useState<{
    entryIndex: number;
    x: number;
    y: number;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!markerEditorOpen) return;
      // A touch long-press selects a loop; keep the browser's menu away.
      if (loopSelectRef.current || isCoarse) e.preventDefault();
      if (loopSelectRef.current?.active) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hit = hitTestEditorEntry(x);
      if (hit === null) return;
      e.preventDefault();
      setMarkerSelectedIndex(hit);
      setMarkerContextMenu({
        entryIndex: hit,
        x,
        y: e.clientY - rect.top,
      });
    },
    [markerEditorOpen, hitTestEditorEntry, setMarkerSelectedIndex],
  );

  // Close the menu automatically if the editor closes or the entry
  // vanishes (e.g. deleted, undo), and on outside click / Escape.
  useEffect(() => {
    if (!markerContextMenu) return;
    if (!markerEditorOpen || markerContextMenu.entryIndex >= editorTapMap.length) {
      setMarkerContextMenu(null);
      return;
    }
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.closest('[data-marker-context-menu]')) return;
      setMarkerContextMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMarkerContextMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [markerContextMenu, markerEditorOpen, editorTapMap.length]);

  const contextMenuEntry =
    markerContextMenu !== null ? editorTapMap[markerContextMenu.entryIndex] : undefined;

  const handleChangeMarkerType = useCallback(
    (newType: TapMapEntry['type']) => {
      if (!markerContextMenu || !contextMenuEntry) return;
      const label =
        newType === 'section' && !contextMenuEntry.label
          ? autoLabelSection(editorTapMap)
          : undefined;
      updateMarkerEntryType(markerContextMenu.entryIndex, newType, label);
      setMarkerContextMenu(null);
    },
    [markerContextMenu, contextMenuEntry, editorTapMap, updateMarkerEntryType],
  );

  // Resolve the section that contains the right-clicked marker, and
  // count beats/measures inside it so the bulk-action rows can show a
  // preview and disable when nothing would happen.
  const contextMenuSection =
    markerContextMenu !== null
      ? (() => {
          const sectionIdx = findEnclosingSectionIndex(
            editorTapMap,
            markerContextMenu.entryIndex,
          );
          if (sectionIdx === null) return null;
          const { start, end } = getSectionRange(editorTapMap, sectionIdx);
          let beats = 0;
          let measures = 0;
          for (const e of editorTapMap) {
            if (e.time < start || e.time >= end) continue;
            if (e.type === 'beat') beats++;
            else if (e.type === 'measure') measures++;
          }
          return {
            sectionIdx,
            label: editorTapMap[sectionIdx].label || '(unnamed)',
            start,
            end,
            beats,
            measures,
          };
        })()
      : null;

  const bulkDeleteInSection = useCallback(
    (mode: 'beats' | 'measures' | 'submarkers') => {
      if (!contextMenuSection) return;
      const { start, end } = contextMenuSection;
      deleteMarkerEntriesWhere((e) => {
        if (e.time < start || e.time >= end) return false;
        if (e.type === 'section') return false;
        if (mode === 'beats') return e.type === 'beat';
        if (mode === 'measures') return e.type === 'measure';
        return e.type === 'beat' || e.type === 'measure';
      });
      setMarkerContextMenu(null);
    },
    [contextMenuSection, deleteMarkerEntriesWhere],
  );

  // --- Pointer event handlers (unified mouse + touch) ---

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Track pointer for pinch
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      // Start pinch if two fingers
      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.abs(pts[0].x - pts[1].x);
        const centerClientX = (pts[0].x + pts[1].x) / 2;
        const centerX = centerClientX - rect.left;
        pinchStartRef.current = { dist, viewDuration: effectiveViewDuration, centerX };
        dragStartRef.current = null;
        setDraggingMarker(null);
        cancelLoopSelect();
        return;
      }

      const y = e.clientY - rect.top;

      // Note marker hit — clicking seeks to the note's time, dragging
      // retimes it. Checked first so a note dot near a tapMap marker
      // still wins.
      const noteHit = hitTestNote(x, y);
      if (noteHit) {
        e.preventDefault();
        const note = notes.find((n) => n.id === noteHit.id);
        if (note) {
          dragNoteRef.current = { id: noteHit.id, time: note.time, startX: x, moved: false, editable: canEditNote(note) };
        }
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Single pointer: check editor-entry hit first when the
      // tapMap editor is open. Entry hits supersede the generic
      // click-to-seek so markers can be selected/dragged without
      // the playhead jumping.
      const editorHit = hitTestEditorEntry(x);
      if (editorHit !== null) {
        e.preventDefault();
        setMarkerSelectedIndex(editorHit);
        dragEditorEntryRef.current = { index: editorHit, time: editorTapMap[editorHit].time, startX: e.clientX, moved: false };
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Single pointer: check lyric marker hit next
      const lyricHit = hitTestLyricMarker(x);
      if (lyricHit !== null) {
        e.preventDefault();
        dragLyricRef.current = { index: lyricHit, time: lyricsLines[lyricHit].time!, startX: e.clientX, moved: false };
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Chord marker (chords editor)
      const chordHit = hitTestChordMarker(x);
      if (chordHit !== null) {
        e.preventDefault();
        const c = editorChords[chordHit];
        dragChordRef.current = { from: c.time, symbol: c.symbol, time: c.time, startX: e.clientX, moved: false };
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Check loop marker hit
      const hit = hitTestLoopMarker(x);
      if (hit) {
        e.preventDefault();
        setDraggingMarker(hit);
        didDragRef.current = false;
        suppressClickRef.current = false;
        return;
      }

      // Start potential drag-to-pan or just track position
      dragStartRef.current = { x: e.clientX, viewStart };
      didDragRef.current = false;

      // Empty waveform: maybe the start of a loop selection.
      cancelLoopSelect();
      if (!duration || e.button !== 0) return;
      const anchor = snapLoopEdge(x, false).time;
      if (e.pointerType === 'mouse') {
        // Plain drag selects; Alt/Option-drag pans like before.
        if (e.altKey) return;
        dragStartRef.current = null;
        loopSelectRef.current = { anchor, current: anchor, startX: e.clientX, active: false };
        return;
      }
      // Touch / pen: hold still for a moment to start selecting.
      loopSelectRef.current = { anchor, current: anchor, startX: e.clientX, active: false };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        const sel = loopSelectRef.current;
        if (!sel || didDragRef.current || pointersRef.current.size !== 1) return;
        sel.active = true;
        dragStartRef.current = null;
        navigator.vibrate?.(10);
        setLoopSelecting(true);
        setLoopSelectTick((n) => n + 1);
      }, LONG_PRESS_MS);
    },
    [hitTestEditorEntry, hitTestLoopMarker, hitTestLyricMarker, hitTestChordMarker, hitTestNote, editorTapMap, lyricsLines, editorChords, notes, canEditNote, setMarkerSelectedIndex, effectiveViewDuration, viewStart, duration, snapLoopEdge, cancelLoopSelect],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Update tracked pointer
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Pinch zoom
      if (pointersRef.current.size === 2 && pinchStartRef.current) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.abs(pts[0].x - pts[1].x);
        if (dist < 1) return;
        const scale = pinchStartRef.current.dist / dist;
        const newDuration = Math.max(MIN_VIEW, Math.min(duration || Infinity, pinchStartRef.current.viewDuration * scale));
        const centerSeconds = pixelToSeconds(pinchStartRef.current.centerX, sizeRef.current.width);
        const newStart = centerSeconds - (pinchStartRef.current.centerX / sizeRef.current.width) * newDuration;
        setViewDuration(newDuration);
        setViewStart(clampViewStart(newStart, newDuration));
        return;
      }

      // Single pointer: drag note marker (only one you may edit; others just seek on click)
      if (dragNoteRef.current) {
        if (!dragNoteRef.current.editable) return;
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        const clamped = Math.max(0, Math.min(seconds, duration || 0));
        dragNoteRef.current.time = clamped;
        if (Math.abs(x - dragNoteRef.current.startX) > DRAG_THRESHOLD) {
          dragNoteRef.current.moved = true;
          suppressClickRef.current = true;
        }
        setNoteDragTick((t) => t + 1);
        return;
      }

      // Single pointer: drag tapMap editor entry
      if (dragEditorEntryRef.current) {
        const drag = dragEditorEntryRef.current;
        if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return;
        drag.moved = true;
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        drag.time = Math.max(0, Math.min(seconds, duration || 0));
        suppressClickRef.current = true;
        setEditorDragTick((n) => n + 1);
        return;
      }

      // Single pointer: drag lyric marker (past a small threshold, so a
      // shaky click still counts as a click)
      if (dragLyricRef.current) {
        const drag = dragLyricRef.current;
        if (!drag.moved && Math.abs(e.clientX - drag.startX) < 4) return;
        drag.moved = true;
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        drag.time = Math.max(0, Math.min(seconds, duration || 0));
        suppressClickRef.current = true;
        return;
      }

      // Single pointer: drag a chord marker, snapping like stamps do
      if (dragChordRef.current) {
        const drag = dragChordRef.current;
        if (!drag.moved && Math.abs(e.clientX - drag.startX) < 4) return;
        drag.moved = true;
        const seconds = Math.max(0, Math.min(pixelToSeconds(x, sizeRef.current.width), duration || 0));
        drag.time = snapTime(seconds, chordGrid, chordSnap);
        setChordDragTick((n) => n + 1);
        suppressClickRef.current = true;
        return;
      }

      // Single pointer: drag loop marker
      if (draggingMarker) {
        const seconds = pixelToSeconds(x, sizeRef.current.width);
        const clamped = Math.max(0, Math.min(seconds, duration || 0));
        if (draggingMarker === 'A') {
          engine.setLoop(clamped, loopB);
        } else {
          engine.setLoop(loopA, clamped);
        }
        suppressClickRef.current = true;
        return;
      }

      // Loop selection: extend it, or decide whether this press becomes one
      const sel = loopSelectRef.current;
      if (sel) {
        const isMouse = e.pointerType === 'mouse';
        if (!sel.active && Math.abs(e.clientX - sel.startX) >= DRAG_THRESHOLD) {
          if (isMouse) {
            sel.active = true;
            setLoopSelecting(true);
            setCursorStyle('ew-resize');
          } else {
            // Moved before the long-press fired: it's a pan, not a selection.
            cancelLoopSelect();
          }
        }
        if (sel.active) {
          const { width } = sizeRef.current;
          const cx = Math.max(0, Math.min(x, width));
          // Hold Alt/Option mid-drag to place an edge off the grid.
          const edge = snapLoopEdge(cx, isMouse && e.altKey);
          sel.current = edge.time;
          setHoveredTime(edge.snapped ? edge.time : null);
          setLoopSelectTick((n) => n + 1);
          return;
        }
        if (isMouse) return;
      }

      // Single-finger drag-to-pan (when zoomed)
      if (dragStartRef.current && isZoomed) {
        const dx = e.clientX - dragStartRef.current.x;
        if (!didDragRef.current && Math.abs(dx) < DRAG_THRESHOLD) return;
        didDragRef.current = true;
        const { width } = sizeRef.current;
        if (width === 0) return;
        const secondsPerPixel = effectiveViewDuration / width;
        const newStart = dragStartRef.current.viewStart - dx * secondsPerPixel;
        setViewStart(clampViewStart(newStart, effectiveViewDuration));
        setFollowPlayhead(false);
        return;
      }

      // Hover effects (non-touch only)
      if (!isCoarse) {
        const noteHit = hitTestNote(x, e.clientY - rect.top);
        const editorIdx = hitTestEditorEntry(x);
        const lyricIdx = hitTestLyricMarker(x);
        const chordIdx = hitTestChordMarker(x);
        const hit = hitTestLoopMarker(x);
        setHoveredNote(noteHit);
        if (noteHit) {
          setCursorStyle('grab');
        } else if (editorIdx !== null || lyricIdx !== null || chordIdx !== null || hit) {
          setCursorStyle('col-resize');
        } else {
          setCursorStyle('pointer');
        }
        setHoveredTime(findSnapMarker(x));
      }
    },
    [draggingMarker, findSnapMarker, hitTestEditorEntry, hitTestLoopMarker, hitTestLyricMarker, hitTestChordMarker, hitTestNote, pixelToSeconds, duration, engine, loopA, loopB, clampViewStart, isZoomed, effectiveViewDuration, setFollowPlayhead, chordGrid, chordSnap, cancelLoopSelect, snapLoopEdge],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);

      // End pinch
      if (pinchStartRef.current) {
        if (pointersRef.current.size < 2) {
          pinchStartRef.current = null;
        }
        dragStartRef.current = null;
        return;
      }

      // End note marker drag — drag commits a setTime, click seeks.
      if (dragNoteRef.current) {
        const { id, time, moved } = dragNoteRef.current;
        if (moved) {
          setNoteTime(id, time);
        } else {
          const note = notes.find((n) => n.id === id);
          if (note && duration) engine.seek(Math.max(0, Math.min(note.time, duration)));
        }
        dragNoteRef.current = null;
        dragStartRef.current = null;
        return;
      }

      // End tapMap editor entry drag (or click-select)
      if (dragEditorEntryRef.current) {
        const { index, time, moved } = dragEditorEntryRef.current;
        // Only commit a move if the pointer actually moved enough
        // to qualify as a drag. A plain click just selects; on touch a
        // tap also moves playback to the marker, like tapping a row in
        // the section list.
        if (moved) {
          moveMarkerEntry(index, time);
          suppressClickRef.current = true;
        } else if (isCoarse) {
          engine.seek(time);
        }
        dragEditorEntryRef.current = null;
        dragStartRef.current = null;
        return;
      }

      // End lyric marker drag. A click without a drag moves playback to
      // that line (the lyrics preview follows) and selects it for timing.
      if (dragLyricRef.current) {
        const { index, time, moved } = dragLyricRef.current;
        if (moved) {
          moveLyricLine(index, time);
          suppressClickRef.current = true;
        } else {
          engine.seek(time);
          setFollowPlayhead(true);
          useLyricsEditorStore.getState().selectLine(index);
        }
        dragLyricRef.current = null;
        dragStartRef.current = null;
        return;
      }

      // End chord marker drag (one undo step), or a click: play from it and select it
      if (dragChordRef.current) {
        const { from, symbol, time, moved } = dragChordRef.current;
        const editor = useChordsEditorStore.getState();
        if (moved && time !== from) {
          editor.applyEdit([from], [{ symbol, time }], time);
          suppressClickRef.current = true;
        } else if (!moved) {
          engine.seek(from);
          setFollowPlayhead(true);
          editor.select(from);
        }
        dragChordRef.current = null;
        dragStartRef.current = null;
        setChordDragTick((n) => n + 1);
        return;
      }

      // End loop marker drag
      if (draggingMarker) {
        suppressClickRef.current = true;
        setDraggingMarker(null);
        dragStartRef.current = null;
        return;
      }

      // End loop selection: set the loop and, if the playhead is outside
      // it, start from the top of it. A long-press released without a
      // drag does nothing. One that never started falls through to the
      // tap-to-seek / pan handling below.
      const sel = loopSelectRef.current;
      cancelLoopSelect();
      if (sel?.active) {
        dragStartRef.current = null;
        didDragRef.current = false;
        setHoveredTime(null);
        setCursorStyle('pointer');
        const a = Math.min(sel.anchor, sel.current);
        const b = Math.max(sel.anchor, sel.current);
        const { width } = sizeRef.current;
        if (secondsToPixel(b, width) - secondsToPixel(a, width) >= DRAG_THRESHOLD) {
          engine.setLoop(a, b);
          const pos = useTransportStore.getState().position;
          if (pos < a || pos >= b) {
            engine.seek(a);
            setFollowPlayhead(true);
          }
        }
        return;
      }

      // End drag-to-pan — if we dragged, don't seek
      if (didDragRef.current) {
        dragStartRef.current = null;
        didDragRef.current = false;
        return;
      }

      dragStartRef.current = null;

      // Tap to seek
      if (pointersRef.current.size === 0) {
        if (!duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const snap = findSnapMarker(x);
        const seconds = snap ?? pixelToSeconds(x, sizeRef.current.width);
        engine.seek(Math.max(0, Math.min(seconds, duration)));
        setFollowPlayhead(true);
      }
    },
    [draggingMarker, moveLyricLine, moveMarkerEntry, setNoteTime, notes, duration, findSnapMarker, pixelToSeconds, secondsToPixel, engine, setFollowPlayhead, cancelLoopSelect],
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      pointersRef.current.delete(e.pointerId);
      setHoveredTime(null);
      if (draggingMarker) {
        setDraggingMarker(null);
      }
      if (pointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
      dragLyricRef.current = null;
      dragChordRef.current = null;
      dragEditorEntryRef.current = null;
      dragNoteRef.current = null;
      cancelLoopSelect();
      setHoveredNote(null);
      dragStartRef.current = null;
      didDragRef.current = false;
      setCursorStyle('pointer');
    },
    [draggingMarker, cancelLoopSelect],
  );

  // Esc drops a loop selection in progress; the release that follows
  // must not count as a click, so it's marked as a drag.
  useEffect(() => {
    if (!loopSelecting) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelLoopSelect();
      didDragRef.current = true;
      setHoveredTime(null);
      setCursorStyle('pointer');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [loopSelecting, cancelLoopSelect]);

  // Cmd+scroll zoom, shift+scroll horizontal navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !duration) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        // Zoom
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const { width } = sizeRef.current;
        if (width === 0) return;

        const cursorSeconds = pixelToSeconds(cursorX, width);
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
        const newDuration = Math.max(MIN_VIEW, Math.min(duration, effectiveViewDuration * zoomFactor));
        // Keep cursor position anchored
        const newStart = cursorSeconds - (cursorX / width) * newDuration;
        setViewDuration(newDuration);
        setViewStart(clampViewStart(newStart, newDuration));
      } else {
        const delta = e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaX;
        if (delta === 0 || !isZoomed) return;
        e.preventDefault();
        const scrollAmount = (delta / 500) * effectiveViewDuration;
        setViewStart((prev) => clampViewStart(prev + scrollAmount, effectiveViewDuration));
        setFollowPlayhead(false);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [duration, effectiveViewDuration, isZoomed, pixelToSeconds, clampViewStart, setFollowPlayhead]);

  // Auto-scroll during playback when zoomed
  useEffect(() => {
    if (!followPlayhead || !isZoomed || !duration) return;
    const rightThreshold = viewStart + effectiveViewDuration * 0.85;
    if (position > rightThreshold || position < viewStart) {
      setViewStart(clampViewStart(position - effectiveViewDuration * 0.25, effectiveViewDuration));
    }
  }, [position, isZoomed, viewStart, effectiveViewDuration, duration, clampViewStart, followPlayhead]);

  // ResizeObserver for main canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      sizeRef.current = { width, height };
      setCanvasReady(true);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ResizeObserver for overview canvas — re-attach when zoom state changes
  useEffect(() => {
    if (!isZoomed) return;
    const container = overviewContainerRef.current;
    const canvas = overviewCanvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      overviewSizeRef.current = { width, height };
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isZoomed]);

  // Draw helper: render markers/tapMap entries onto a canvas context
  const drawMarkers = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      toPixel: (seconds: number) => number,
    ) => {
      const tapMap = displayTapMap;
      if (tapMap && tapMap.length > 0) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'top';

        for (let i = 0; i < tapMap.length; i++) {
          const entry = tapMap[i];
          // Substitute the live drag time for whichever entry is
          // being moved, so the rendered line tracks the cursor.
          const displayTime = markerEditorOpen && dragEditorEntryRef.current?.index === i
            ? dragEditorEntryRef.current.time
            : entry.time;
          const x = toPixel(displayTime);
          if (x < -1 || x > width + 1) continue;

          const isSelected = markerEditorOpen && markerSelectedIndex === i;

          if (entry.type === 'beat') {
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 0.5;
          } else if (entry.type === 'measure') {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
          }

          if (isSelected) {
            ctx.shadowColor = '#60a5fa';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
          }

          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          if (isSelected) {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
          }

          if (entry.type === 'section' && entry.label) {
            const textWidth = ctx.measureText(entry.label).width;
            const labelX = Math.min(x + 3, width - textWidth - 4);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(entry.label, labelX + 1, 3);
          }
        }
      } else if (selectedSong) {
        const markers = markersToSeconds(selectedSong.markers, selectedSong.tempoMap, selectedSong.beatOffset);
        ctx.font = '10px ui-monospace, monospace';
        ctx.textBaseline = 'top';

        for (const marker of markers) {
          const x = toPixel(marker.seconds);
          if (x < -1 || x > width + 1) continue;

          ctx.strokeStyle = marker.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          const textWidth = ctx.measureText(marker.name).width;
          const labelX = Math.min(x + 3, width - textWidth - 4);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(labelX - 1, 1, textWidth + 4, 13);
          ctx.fillStyle = marker.color;
          ctx.fillText(marker.name, labelX + 1, 3);
        }
      }

      // Note markers (timestamp notes, visible to everyone). Substitutes
      // the live drag time for a dragging note so the dot tracks the cursor.
      if (notes.length > 0) {
        ctx.fillStyle = NOTE_COLOR;
        for (const note of notes) {
          const t = dragNoteRef.current?.id === note.id ? dragNoteRef.current.time : note.time;
          const x = toPixel(t);
          if (x < -4 || x > width + 4) continue;
          ctx.beginPath();
          ctx.arc(x, height - 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Lyric markers (when editor is open)
      if (lyricsEditorOpen && lyricsLines.length > 0) {
        ctx.font = '9px ui-monospace, monospace';
        ctx.textBaseline = 'bottom';
        for (let i = 0; i < lyricsLines.length; i++) {
          const t = dragLyricRef.current?.index === i
            ? dragLyricRef.current.time
            : lyricsLines[i].time;
          if (t === null) continue;
          const x = toPixel(t);
          if (x < -1 || x > width + 1) continue;

          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          const label = String(i + 1);
          const tw = ctx.measureText(label).width;
          const lx = Math.min(x - tw / 2, width - tw - 2);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(Math.max(0, lx - 1), height - 13, tw + 4, 12);
          ctx.fillStyle = '#06b6d4';
          ctx.fillText(label, Math.max(1, lx + 1), height - 2);
        }
      }

      // Chord markers (chords editor): pink, with the chord name. A label
      // that would run into the one before it is left off at this zoom.
      if (chordsEditorOpen && editorChords.length > 0) {
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.textBaseline = 'bottom';
        const drag = dragChordRef.current;
        const shown = editorChords
          .map((c) => (drag?.moved && c.time === drag.from ? { ...c, time: drag.time } : c))
          .sort((a, b) => a.time - b.time);
        let labelEnd = -Infinity;
        for (const c of shown) {
          const x = toPixel(c.time);
          if (x < -1 || x > width + 1) continue;
          const dragged = !!drag?.moved && c.time === drag.time && c.symbol === drag.symbol;

          ctx.strokeStyle = CHORD_MARKER_COLOR;
          ctx.lineWidth = dragged ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();

          const name = displayChord(c.symbol);
          const tw = ctx.measureText(name).width;
          const lx = Math.min(x + 2, width - tw - 3);
          if (lx <= labelEnd + 3 && !dragged) continue;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(lx - 1, height - 14, tw + 4, 13);
          ctx.fillStyle = CHORD_MARKER_COLOR;
          ctx.fillText(name, lx + 1, height - 2);
          labelEnd = lx + tw + 3;
        }
      }
    },
    [selectedSong, displayTapMap, markerEditorOpen, markerSelectedIndex, lyricsEditorOpen, lyricsLines, chordsEditorOpen, editorChords, chordDragTick, notes, noteDragTick, editorDragTick],
  );

  // Draw main canvas (viewport-relative)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peakData = engine.peakData;
    if (!peakData || !duration) {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, width, height);

    // Waveform — viewport-relative
    const centerY = height / 2;
    const halfHeight = height / 2 - 2;
    drawPeaks(ctx, peakData, engine.peaksPerSecond, viewStart, effectiveViewDuration, width, centerY, halfHeight, '#4B5563');

    // Played region tint
    const playheadX = secondsToPixel(position, width);
    if (playheadX > 0) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(0, 0, Math.min(playheadX, width), height);
    }

    // Markers
    drawMarkers(ctx, width, height, (s) => secondsToPixel(s, width));

    // Loop bracket markers and region highlight
    if (loopA !== null || loopB !== null) {
      const loopColor = loopEnabled ? '#eab308' : '#eab30860';
      ctx.strokeStyle = loopColor;
      ctx.lineWidth = 2;
      const bracketW = 6;

      // Fill between brackets when both are set
      if (loopA !== null && loopB !== null) {
        const ax = secondsToPixel(loopA, width);
        const bx = secondsToPixel(loopB, width);
        ctx.fillStyle = loopEnabled ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.06)';
        ctx.fillRect(ax, 0, bx - ax, height);
      }

      // "[" bracket at loop-in
      if (loopA !== null) {
        const ax = secondsToPixel(loopA, width);
        ctx.beginPath();
        ctx.moveTo(ax + bracketW, 0);
        ctx.lineTo(ax, 0);
        ctx.lineTo(ax, height);
        ctx.lineTo(ax + bracketW, height);
        ctx.stroke();
      }

      // "]" bracket at loop-out
      if (loopB !== null) {
        const bx = secondsToPixel(loopB, width);
        ctx.beginPath();
        ctx.moveTo(bx - bracketW, 0);
        ctx.lineTo(bx, 0);
        ctx.lineTo(bx, height);
        ctx.lineTo(bx - bracketW, height);
        ctx.stroke();
      }
    }

    // Loop selection in progress: a brighter band with dashed ends
    const sel = loopSelectRef.current;
    if (sel?.active) {
      const x1 = secondsToPixel(Math.min(sel.anchor, sel.current), width);
      const x2 = secondsToPixel(Math.max(sel.anchor, sel.current), width);
      ctx.fillStyle = 'rgba(234, 179, 8, 0.25)';
      ctx.fillRect(x1, 0, x2 - x1, height);
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, height);
      ctx.moveTo(x2, 0);
      ctx.lineTo(x2, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Hover highlight
    if (hoveredTime !== null) {
      const hx = secondsToPixel(hoveredTime, width);
      if (hx >= 0 && hx <= width) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(hx - 6, 0, 12, height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, height);
        ctx.stroke();
      }
    }

    // Playhead
    if (playheadX >= 0 && playheadX <= width) {
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(Math.round(playheadX) - 1, 0, 2, height);
    }
  }, [engine.peakData, engine.peaksPerSecond, peaksVersion, position, duration, selectedSong, hoveredTime, viewStart, effectiveViewDuration, secondsToPixel, drawMarkers, loopA, loopB, loopEnabled, canvasReady, loopSelectTick]);

  // Draw overview canvas (full song, only when zoomed)
  useEffect(() => {
    if (!isZoomed) return;
    const canvas = overviewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = overviewSizeRef.current;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peakData = engine.peakData;
    if (!peakData || !duration) return;

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Waveform (full song)
    const centerY = height / 2;
    const halfHeight = height / 2 - 1;
    drawPeaks(ctx, peakData, engine.peaksPerSecond, 0, duration, width, centerY, halfHeight, '#374151');

    // Section markers only (keep overview clean)
    const tapMap = selectedSong?.tapMap;
    if (tapMap) {
      for (const entry of tapMap as TapMapEntry[]) {
        if (entry.type !== 'section') continue;
        const x = (entry.time / duration) * width;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Loop region on overview
    if (loopA !== null || loopB !== null) {
      ctx.strokeStyle = loopEnabled ? '#eab308' : '#eab30860';
      ctx.lineWidth = 1;
      if (loopA !== null && loopB !== null) {
        const oax = (loopA / duration) * width;
        const obx = (loopB / duration) * width;
        ctx.fillStyle = loopEnabled ? 'rgba(234, 179, 8, 0.2)' : 'rgba(234, 179, 8, 0.08)';
        ctx.fillRect(oax, 0, obx - oax, height);
      }
      if (loopA !== null) {
        const oax = (loopA / duration) * width;
        ctx.beginPath(); ctx.moveTo(oax, 0); ctx.lineTo(oax, height); ctx.stroke();
      }
      if (loopB !== null) {
        const obx = (loopB / duration) * width;
        ctx.beginPath(); ctx.moveTo(obx, 0); ctx.lineTo(obx, height); ctx.stroke();
      }
    }

    // Viewport indicator
    const vx1 = (viewStart / duration) * width;
    const vx2 = ((viewStart + effectiveViewDuration) / duration) * width;
    ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
    ctx.fillRect(vx1, 0, vx2 - vx1, height);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx1, 0, vx2 - vx1, height);

    // Playhead
    const phx = (position / duration) * width;
    ctx.fillStyle = '#3B82F6';
    ctx.fillRect(Math.round(phx) - 0.5, 0, 1.5, height);
  }, [engine.peakData, engine.peaksPerSecond, peaksVersion, position, duration, selectedSong, isZoomed, viewStart, effectiveViewDuration, loopA, loopB, loopEnabled]);

  // Overview strip: drag the view box to slide the main waveform. Grab
  // the box anywhere and it keeps that grip; press outside it and the box
  // centers on the pointer, then follows the drag. A click without a drag
  // still moves playback there, as before.
  const overviewDragRef = useRef<{ offset: number; startX: number; moved: boolean } | null>(null);
  const [overviewCursor, setOverviewCursor] = useState<'pointer' | 'grab' | 'grabbing'>('pointer');

  const overviewTime = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      return rect.width > 0 ? (x / rect.width) * duration : 0;
    },
    [duration],
  );

  const handleOverviewPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!duration || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const t = overviewTime(e);
      const inBox = t >= viewStart && t <= viewStart + effectiveViewDuration;
      const offset = inBox ? t - viewStart : effectiveViewDuration / 2;
      overviewDragRef.current = { offset, startX: e.clientX, moved: false };
      setOverviewCursor('grabbing');
    },
    [duration, overviewTime, viewStart, effectiveViewDuration],
  );

  const handleOverviewPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const t = overviewTime(e);
      const drag = overviewDragRef.current;
      if (!drag) {
        setOverviewCursor(t >= viewStart && t <= viewStart + effectiveViewDuration ? 'grab' : 'pointer');
        return;
      }
      if (!drag.moved && Math.abs(e.clientX - drag.startX) < 3) return;
      drag.moved = true;
      setViewStart(clampViewStart(t - drag.offset, effectiveViewDuration));
      setFollowPlayhead(false);
    },
    [overviewTime, viewStart, effectiveViewDuration, clampViewStart, setFollowPlayhead],
  );

  const handleOverviewPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = overviewDragRef.current;
      overviewDragRef.current = null;
      setOverviewCursor('grab');
      if (!drag || drag.moved || !duration) return;
      const seconds = overviewTime(e);
      engine.seek(seconds);
      setViewStart(clampViewStart(seconds - effectiveViewDuration / 2, effectiveViewDuration));
      setFollowPlayhead(true);
    },
    [engine, duration, overviewTime, effectiveViewDuration, clampViewStart, setFollowPlayhead],
  );

  const handleOverviewPointerCancel = useCallback(() => {
    overviewDragRef.current = null;
    setOverviewCursor('pointer');
  }, []);

  // Mobile zoom controls
  const handleZoom = useCallback(
    (direction: 'in' | 'out') => {
      if (!duration) return;
      const { width } = sizeRef.current;
      if (width === 0) return;
      const centerSeconds = viewStart + effectiveViewDuration / 2;
      const factor = direction === 'in' ? 0.6 : 1.6;
      const newDuration = Math.max(MIN_VIEW, Math.min(duration, effectiveViewDuration * factor));
      const newStart = centerSeconds - newDuration / 2;
      setViewDuration(newDuration);
      setViewStart(clampViewStart(newStart, newDuration));
    },
    [duration, viewStart, effectiveViewDuration, clampViewStart],
  );

  return (
    <div className="flex-1 flex flex-col gap-0.5 min-w-0">
      {/* Main waveform */}
      <div
        ref={containerRef}
        data-waveform-timeline={compact ? undefined : true}
        // The waveform paints its own dark panel; overlays keep the stock colors.
        className={`theme-default ${compact ? 'h-[44px]' : 'h-[80px] md:h-[108px]'} relative rounded overflow-hidden`}
        // No iOS callout or text selection on the press-and-hold that starts a loop.
        style={{ cursor: cursorStyle, touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onPointerCancel={handlePointerLeave}
          onContextMenu={handleContextMenu}
        />
        {hoveredNote && !dragNoteRef.current && (() => {
          const note = notes.find((n) => n.id === hoveredNote.id);
          if (!note) return null;
          const { width } = sizeRef.current;
          if (width === 0) return null;
          const cx = secondsToPixel(note.time, width);
          if (cx < -100 || cx > width + 100) return null;
          const TIP_W = 220;
          const left = Math.max(4, Math.min(cx - TIP_W / 2, width - TIP_W - 4));
          const text = note.text.trim() || '(empty)';
          const tipColor = NOTE_COLOR;
          return (
            <div
              className="absolute pointer-events-none z-20 rounded border px-2 py-1 text-xs leading-snug shadow-lg whitespace-pre-wrap"
              style={{
                left,
                bottom: 18,
                width: TIP_W,
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                borderColor: tipColor,
                color: tipColor,
              }}
            >
              {text}
            </div>
          );
        })()}
        {/* Rendered on document.body so the waveform's overflow-hidden
            box can't crop it; placed at the click and kept on screen. */}
        {markerContextMenu && contextMenuEntry && createPortal(
          <div
            data-marker-context-menu
            ref={(el) => {
              const canvas = canvasRef.current;
              if (!el || !canvas) return;
              const r = canvas.getBoundingClientRect();
              const pad = 8;
              const left = Math.min(r.left + markerContextMenu.x, window.innerWidth - el.offsetWidth - pad);
              const top = Math.min(r.top + markerContextMenu.y, window.innerHeight - el.offsetHeight - pad);
              el.style.left = `${Math.max(pad, left)}px`;
              el.style.top = `${Math.max(pad, top)}px`;
              el.style.visibility = 'visible';
            }}
            className="fixed z-[100] rounded border border-gray-600 bg-gray-800 shadow-lg text-xs text-gray-100 overflow-hidden"
            style={{ minWidth: 200, visibility: 'hidden' }}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-700">
              Change type
            </div>
            {(['section', 'measure', 'beat'] as const).map((t) => {
              const isCurrent = contextMenuEntry.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => handleChangeMarkerType(t)}
                  className={`w-full text-left px-2 py-1.5 flex items-center justify-between transition-colors ${
                    isCurrent
                      ? 'bg-gray-700/60 text-gray-400 cursor-default'
                      : 'hover:bg-blue-900/40 text-gray-100'
                  }`}
                >
                  <span className="capitalize">{t}</span>
                  {isCurrent && <span className="text-[10px]">current</span>}
                </button>
              );
            })}
            {contextMenuSection && (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 border-t border-b border-gray-700">
                  <span className="truncate">
                    In section {contextMenuSection.label}
                  </span>
                </div>
                {([
                  ['beats', 'Delete all beats', contextMenuSection.beats],
                  ['measures', 'Delete all measures', contextMenuSection.measures],
                  [
                    'submarkers',
                    'Delete all sub-markers',
                    contextMenuSection.beats + contextMenuSection.measures,
                  ],
                ] as const).map(([mode, label, count]) => {
                  const disabled = count === 0;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      onClick={() => bulkDeleteInSection(mode)}
                      className={`w-full text-left px-2 py-1.5 flex items-center justify-between transition-colors ${
                        disabled
                          ? 'text-gray-500 cursor-default'
                          : 'hover:bg-red-900/40 text-gray-100'
                      }`}
                    >
                      <span>{label}</span>
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>,
          document.body,
        )}
      </div>

      {/* Overview bar + zoom controls — only visible when zoomed */}
      {isZoomed && (
        <div className="flex items-center gap-1">
          {/* Zoom buttons — mobile only */}
          <button
            className="md:hidden w-7 h-5 flex items-center justify-center text-xs text-gray-400 bg-gray-700 rounded hover:bg-gray-600"
            onClick={() => handleZoom('out')}
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <div
            ref={overviewContainerRef}
            className="flex-1 h-5 relative rounded overflow-hidden border border-gray-700/50"
            style={{ cursor: overviewCursor, touchAction: 'none', userSelect: 'none' }}
          >
            <canvas
              ref={overviewCanvasRef}
              className="w-full h-full"
              onPointerDown={handleOverviewPointerDown}
              onPointerMove={handleOverviewPointerMove}
              onPointerUp={handleOverviewPointerUp}
              onPointerCancel={handleOverviewPointerCancel}
              onPointerLeave={() => { if (!overviewDragRef.current) setOverviewCursor('pointer'); }}
            />
          </div>
          <button
            className="md:hidden w-7 h-5 flex items-center justify-center text-xs text-gray-400 bg-gray-700 rounded hover:bg-gray-600"
            onClick={() => handleZoom('in')}
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
