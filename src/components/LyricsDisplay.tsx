import { useRef, useState, useEffect, useCallback } from 'react';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { useTransportStore } from '../store/transportStore';
import { useLyricsStore } from '../store/lyricsStore';

const PRE_SHIFT_MS = 500;

export function LyricsDisplay() {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const playing = useTransportStore((s) => s.playing);
  const lines = useLyricsStore((s) => s.lines);

  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [targetIndex, setTargetIndex] = useState(-1);
  const [translateX, setTranslateX] = useState(0);
  const manualOffsetRef = useRef(0);
  const scrollLockedRef = useRef(false);
  const resumeAtIndexRef = useRef(-1);

  // Compute which lyric should be bolded based on playback position
  const computeTarget = useCallback(() => {
    if (lines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time! <= position) idx = i;
    }
    // Pre-shift: if we're within 500ms of the next line, shift early
    const next = lines[idx + 1];
    if (next && position >= next.time! - PRE_SHIFT_MS / 1000) {
      idx = idx + 1;
    }
    return idx;
  }, [lines, position]);

  // Update target index (always tracks playback, even during manual scroll)
  useEffect(() => {
    const next = computeTarget();
    if (next !== targetIndex) setTargetIndex(next);
  }, [computeTarget, targetIndex]);

  // Compute autoscroll translateX for a given index
  const getAutoTranslateX = useCallback((idx: number) => {
    const container = containerRef.current;
    const elIdx = idx >= 0 ? idx : 0;
    const el = itemRefs.current[elIdx];
    if (!container || !el) return 0;
    const containerWidth = container.offsetWidth;
    const center = containerWidth * 0.25;
    return center - el.offsetLeft - el.offsetWidth / 2;
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

  // Find which lyric is closest to the 25% reading point at current translateX
  const findIndexAtReadingPoint = useCallback((tx: number) => {
    const container = containerRef.current;
    if (!container) return -1;
    const readingX = container.offsetWidth * 0.25;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const elCenter = el.offsetLeft + el.offsetWidth / 2 + tx;
      const dist = Math.abs(elCenter - readingX);
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

  if (lines.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden py-2 border-b border-gray-700"
      style={{ height: 40 }}
    >
      {/* Microphone icon — aligned under play/pause */}
      <div className="absolute left-0 top-0 h-full z-10 flex items-center pl-14 md:pl-20 pr-4"
        style={{ background: 'linear-gradient(to right, var(--band-bg, #111827) 70%, transparent)' }}
      >
        <span className="text-4xl leading-none">🎤</span>
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
                    ? 'mx-3 text-gray-400'
                    : 'mx-3 text-gray-600'
                  : isCurrent
                    ? 'text-gray-100 font-medium'
                    : isPast
                      ? 'text-gray-600'
                      : 'text-gray-500'
              }`}
            >
              {line.instrumental ? (
                <svg className="inline-block w-16 h-5" viewBox="0 0 120 40" fill="currentColor">
                  {/* First group — three ascending beamed eighth notes */}
                  <circle cx="6" cy="34" r="4.5" />
                  <rect x="10" y="10" width="2.5" height="25" />
                  <circle cx="22" cy="30" r="4.5" />
                  <rect x="26" y="6" width="2.5" height="25" />
                  <circle cx="38" cy="26" r="4.5" />
                  <rect x="42" y="2" width="2.5" height="25" />
                  <polygon points="10,18 12.5,18 44.5,2 42,2" />
                  {/* Second group — three ascending beamed eighth notes */}
                  <circle cx="66" cy="34" r="4.5" />
                  <rect x="70" y="10" width="2.5" height="25" />
                  <circle cx="82" cy="30" r="4.5" />
                  <rect x="86" y="6" width="2.5" height="25" />
                  <circle cx="98" cy="26" r="4.5" />
                  <rect x="102" y="2" width="2.5" height="25" />
                  <polygon points="70,18 72.5,18 104.5,2 102,2" />
                </svg>
              ) : line.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
