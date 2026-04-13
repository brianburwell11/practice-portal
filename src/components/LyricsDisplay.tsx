import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { useTransportStore } from '../store/transportStore';
import { useLyricsStore } from '../store/lyricsStore';
import type { LyricsLine } from '../audio/lyricsTypes';

const PRE_SHIFT_MS = 500;

interface LyricsDisplayProps {
  overrideLines?: LyricsLine[];
}

export function LyricsDisplay({ overrideLines }: LyricsDisplayProps) {
  const position = useTransportStore((s) => s.position);
  const storeLines = useLyricsStore((s) => s.lines);
  const mobileVisible = useLyricsStore((s) => s.mobileVisible);

  // Use override lines (from editor) or store lines, excluding blank lines
  const lines = useMemo(() => {
    const raw = overrideLines ?? storeLines;
    return raw.filter((l) => l.text !== '' || l.instrumental);
  }, [overrideLines, storeLines]);

  // Compute which lyric should be bolded based on playback position
  const computeTarget = useCallback(() => {
    if (lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time !== null && lines[i].time! <= position) idx = i;
    }
    // Pre-shift: if we're within 500ms of the next synced line, shift early
    const next = lines.find((l, j) => j > idx && l.time !== null);
    if (next && position >= next.time! - PRE_SHIFT_MS / 1000) {
      idx = lines.indexOf(next);
    }
    return idx;
  }, [lines, position]);

  const [targetIndex, setTargetIndex] = useState(-1);

  // Update target index (always tracks playback, even during manual scroll)
  useEffect(() => {
    const next = computeTarget();
    if (next !== targetIndex) setTargetIndex(next);
  }, [computeTarget, targetIndex]);

  if (lines.length === 0) return null;

  return (
    <>
      <HorizontalTrack lines={lines} targetIndex={targetIndex} className="hidden md:block" />
      <VerticalTrack lines={lines} targetIndex={targetIndex} className={mobileVisible ? 'md:hidden' : 'hidden'} />
    </>
  );
}

interface TrackProps {
  lines: LyricsLine[];
  targetIndex: number;
  className?: string;
}

/* ---------- Horizontal (desktop) ---------- */

function HorizontalTrack({ lines, targetIndex, className }: TrackProps) {
  const engine = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [translateX, setTranslateX] = useState(0);
  const manualOffsetRef = useRef(0);
  const scrollLockedRef = useRef(false);
  const resumeAtIndexRef = useRef(-1);

  // Compute autoscroll translateX for a given index
  const getAutoTranslateX = useCallback((idx: number) => {
    const container = containerRef.current;
    const elIdx = idx >= 0 ? idx : 0;
    const el = itemRefs.current[elIdx];
    if (!container || !el) return 0;
    const containerWidth = container.offsetWidth;
    const readingX = containerWidth * 0.18;
    return readingX - el.offsetLeft;
  }, []);

  // Check if scroll lock should be released
  useEffect(() => {
    if (!scrollLockedRef.current || resumeAtIndexRef.current < 0) return;
    if (targetIndex >= resumeAtIndexRef.current) {
      scrollLockedRef.current = false;
      resumeAtIndexRef.current = -1;
      manualOffsetRef.current = 0;
    }
  }, [targetIndex]);

  // On pause, clear scroll lock and snap to current lyric
  useEffect(() => {
    if (!playing) {
      scrollLockedRef.current = false;
      resumeAtIndexRef.current = -1;
      manualOffsetRef.current = 0;
      setTranslateX(getAutoTranslateX(targetIndex));
    }
  }, [playing, targetIndex, getAutoTranslateX]);

  // Compute translateX — autoscroll unless manually scrolled
  useEffect(() => {
    if (scrollLockedRef.current) return;
    const tx = getAutoTranslateX(targetIndex);
    setTranslateX(tx);
  }, [targetIndex, lines, getAutoTranslateX]);

  // Find which lyric is closest to the reading point at current translateX
  const findIndexAtReadingPoint = useCallback((tx: number) => {
    const container = containerRef.current;
    if (!container) return -1;
    const readingX = container.offsetWidth * 0.18;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const elLeft = el.offsetLeft + tx;
      const dist = Math.abs(elLeft - readingX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }
    return closest;
  }, [lines]);

  // Shift+scroll handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      e.preventDefault();

      // Enter scroll lock mode
      if (!scrollLockedRef.current) {
        scrollLockedRef.current = true;
        manualOffsetRef.current = 0;
      }

      // Apply scroll delta
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      manualOffsetRef.current -= delta;

      const autoTx = getAutoTranslateX(targetIndex);
      const newTx = autoTx + manualOffsetRef.current;
      setTranslateX(newTx);

      // Find which lyric is at the reading point and set as resume target
      resumeAtIndexRef.current = findIndexAtReadingPoint(newTx);
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [targetIndex, getAutoTranslateX, findIndexAtReadingPoint]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden py-2 ${className ?? ''}`}
      style={{
        height: 40,
        maskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 160px), transparent calc(100% - 112px))',
        WebkitMaskImage: 'linear-gradient(to right, transparent 112px, black 160px, black calc(100% - 160px), transparent calc(100% - 112px))',
      }}
    >
      {/* Microphone icon — aligned under play/pause */}
      <div className="absolute left-0 top-0 h-full z-10 flex items-center pl-14 md:pl-20">
        <svg className="w-8 h-8 text-gray-300" viewBox="0 0 512 512" fill="currentColor">
          <rect x="19.564" y="447.635" transform="matrix(-0.7071 -0.7071 0.7071 -0.7071 -285.559 842.3594)" width="24.231" height="65.371" />
          <polygon points="0.17,494.699 46.394,448.809 63.188,465.945 17.133,511.66" />
          <path d="M43.642,412.297l220.223-264.551l100.371,100.738L99.549,468.203L43.642,412.297z" />
          <path d="M391.48,238.551l-118.1-118.199c-0.279-30.238,11.02-59.379,31.887-81.891l168.268,168.614c-22.131,20.18-50.791,31.484-80.695,31.484L391.48,238.551z" />
          <path d="M330.783,17.23c18.611-10.984,40.072-16.992,62.018-16.992c31.787,0,61.664,12.371,84.127,34.832c38.895,38.898,46.123,98.863,17.625,145.93L330.783,17.23z" />
        </svg>
      </div>

      {/* Scrolling lyrics */}
      <div
        ref={trackRef}
        className="flex items-center gap-4 whitespace-nowrap h-full"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: scrollLockedRef.current ? 'none' : 'transform 500ms ease',
        }}
      >
        {lines.map((line, i) => {
          const isCurrent = i === targetIndex;
          const isPast = i < targetIndex;

          return (
            <span
              key={i}
              ref={(el) => { itemRefs.current[i] = el; }}
              onClick={() => { if (line.time !== null) engine.seek(line.time); }}
              className={`text-sm transition-all duration-300 shrink-0 cursor-pointer hover:text-gray-100 ${
                line.instrumental
                  ? isCurrent
                    ? 'mx-3 text-gray-100 font-medium'
                    : isPast
                      ? 'mx-3 text-gray-600'
                      : 'mx-3 text-gray-500'
                  : isCurrent
                    ? 'text-gray-100 font-medium'
                    : isPast
                      ? 'text-gray-600'
                      : 'text-gray-500'
              }`}
            >
              {line.instrumental ? <InstrumentalIcon /> : line.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Vertical (mobile) ---------- */

const MOBILE_LINE_HEIGHT = 40;
const MOBILE_VISIBLE_LINES = 6;
const MOBILE_CONTAINER_HEIGHT = MOBILE_LINE_HEIGHT * MOBILE_VISIBLE_LINES;

function VerticalTrack({ lines, targetIndex, className }: TrackProps) {
  const engine = useAudioEngine();
  const playing = useTransportStore((s) => s.playing);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [translateY, setTranslateY] = useState(0);

  // Compute autoscroll translateY for a given index — current lyric's top edge sits at 1/3 from top
  const getAutoTranslateY = useCallback((idx: number) => {
    const container = containerRef.current;
    const elIdx = idx >= 0 ? idx : 0;
    const el = itemRefs.current[elIdx];
    if (!container || !el) return 0;
    const readingY = MOBILE_LINE_HEIGHT; // second line from top
    return readingY - el.offsetTop;
  }, []);

  // Autoscroll on target change
  useEffect(() => {
    setTranslateY(getAutoTranslateY(targetIndex));
  }, [targetIndex, lines, getAutoTranslateY]);

  // On pause, snap to current lyric
  useEffect(() => {
    if (!playing) setTranslateY(getAutoTranslateY(targetIndex));
  }, [playing, targetIndex, getAutoTranslateY]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{
        height: MOBILE_CONTAINER_HEIGHT,
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 16.67%, black 83.33%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 16.67%, black 83.33%, transparent 100%)',
      }}
    >
      <div
        className="flex flex-col items-center"
        style={{
          transform: `translateY(${translateY}px)`,
          transition: 'transform 500ms ease',
        }}
      >
        {lines.map((line, i) => {
          const isCurrent = i === targetIndex;
          const isPast = i < targetIndex;

          return (
            <div
              key={i}
              ref={(el) => { itemRefs.current[i] = el; }}
              onClick={() => { if (line.time !== null) engine.seek(line.time); }}
              className={`w-full flex items-center justify-center text-center text-base transition-all duration-300 cursor-pointer px-4 ${
                isCurrent
                  ? 'text-gray-100 font-medium'
                  : isPast
                    ? 'text-gray-600'
                    : 'text-gray-500'
              }`}
              style={{ height: MOBILE_LINE_HEIGHT }}
            >
              {line.instrumental ? <InstrumentalIcon /> : line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Shared instrumental icon ---------- */

function InstrumentalIcon() {
  return (
    <svg className="inline-block w-7 h-7" viewBox="-5.5 0 32 32" fill="currentColor">
      <path d="M5.688 9.656v10.906c-0.469-0.125-0.969-0.219-1.406-0.219-1 0-2.031 0.344-2.875 0.906s-1.406 1.469-1.406 2.531c0 1.125 0.563 1.969 1.406 2.531s1.875 0.875 2.875 0.875c0.938 0 2-0.313 2.844-0.875s1.375-1.406 1.375-2.531v-11.438l9.531-2.719v7.531c-0.438-0.125-0.969-0.188-1.438-0.188-0.969 0-2.031 0.281-2.875 0.844s-1.375 1.469-1.375 2.531c0 1.125 0.531 2 1.375 2.531 0.844 0.563 1.906 0.906 2.875 0.906 0.938 0 2.031-0.344 2.875-0.906 0.875-0.531 1.406-1.406 1.406-2.531v-14.406c0-0.688-0.469-1.156-1.156-1.156-0.063 0-0.438 0.125-1.031 0.281-1.25 0.344-3.125 0.875-5.25 1.5-1.094 0.281-2.063 0.594-3.031 0.844-0.938 0.281-1.75 0.563-2.469 0.75-0.75 0.219-1.219 0.344-1.406 0.406-0.5 0.156-0.844 0.594-0.844 1.094z" />
    </svg>
  );
}
