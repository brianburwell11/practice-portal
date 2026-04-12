import { useRef, useState, useEffect, useCallback } from 'react';
import { useTransportStore } from '../store/transportStore';
import { useLyricsStore } from '../store/lyricsStore';

const PRE_SHIFT_MS = 500;

export function LyricsDisplay() {
  const position = useTransportStore((s) => s.position);
  const lines = useLyricsStore((s) => s.lines);

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [translateX, setTranslateX] = useState(0);

  // Compute which lyric should be centered based on position + 500ms pre-shift
  const computeTarget = useCallback(() => {
    if (lines.length === 0) return 0;
    let idx = 0;
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

  // Update target index
  useEffect(() => {
    const next = computeTarget();
    if (next !== targetIndex) setTargetIndex(next);
  }, [computeTarget, targetIndex]);

  // Compute translateX to center the target element
  useEffect(() => {
    const container = containerRef.current;
    const el = itemRefs.current[targetIndex];
    if (!container || !el) return;

    const containerWidth = container.offsetWidth;
    const elLeft = el.offsetLeft;
    const elWidth = el.offsetWidth;
    const center = containerWidth * 0.25;

    setTranslateX(center - elLeft - elWidth / 2);
  }, [targetIndex, lines]);

  if (lines.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden px-4 py-2 border-b border-gray-700"
      style={{ height: 40 }}
    >
      <div
        className="flex items-center gap-4 whitespace-nowrap h-full"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: 'transform 500ms ease',
        }}
      >
        {lines.map((line, i) => {
          const isCurrent = i === targetIndex;
          const isPast = i < targetIndex;

          return (
            <span
              key={i}
              ref={(el) => { itemRefs.current[i] = el; }}
              className={`text-sm transition-opacity duration-300 shrink-0 ${
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
