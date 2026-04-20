import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, beatWidthStats, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import { secondsToBeat, audioOffsetSeconds, buildBeatTimes, type WiggleConfig, type BeatTime } from './wiggleSync';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

/**
 * Widget 1 — Infinite horizontal scroll under a fixed playhead.
 *
 * The score lays out as a single very-wide line (no system breaks).
 * The wrapper div is the scrollable surface; the playhead is a fixed
 * vertical bar painted on top at a chosen percentage of the viewport.
 * As audio plays, we scroll the score so the cursor's x-position lines
 * up under the playhead.
 */
export function InfiniteHorizontalDemo({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const osmdRef = useRef<any>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  // Load config once
  useEffect(() => {
    let cancelled = false;
    fetch(configUrl)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setConfig(j); })
      .catch((e) => console.error('config load', e));
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);
  const audioOffset = useMemo(() => (config ? audioOffsetSeconds(config) : 0), [config]);

  // Find the OSMD scroll host once the renderer is ready
  const handleReady = useCallback((osmd: any) => {
    osmdRef.current = osmd;
    // The renderer's wrapper structure: <root><scrollHost><containerRef>...
    if (osmd?.container?.parentElement) {
      scrollHostRef.current = osmd.container.parentElement;
    }
  }, []);

  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);

  // Map currentTime → score-beat → cursor x → scrollLeft
  useEffect(() => {
    if (timeline.length === 0 || !scrollHostRef.current) return;
    // Wiggle: audio seconds → score beat (via tapMap) — first downbeat at ~2.3s
    const scoreBeat = config ? secondsToBeat(currentTime + offsetSec, beatTimes, 120) : 0;
    // Find the cursor index whose absoluteBeat ≤ scoreBeat
    const idx = findCursorIdx(scoreBeat, timeline);
    const stamp = timeline[idx];
    if (!stamp) return;
    // Interpolate between this and the next cursor x for sub-step smoothness
    const next = timeline[idx + 1];
    let xPx = stamp.xPx;
    if (next) {
      const dBeat = next.absoluteBeat - stamp.absoluteBeat;
      if (dBeat > 0) {
        const frac = Math.max(0, Math.min(1, (scoreBeat - stamp.absoluteBeat) / dBeat));
        xPx = stamp.xPx + frac * (next.xPx - stamp.xPx);
      }
    }
    const target = xPx - scrollHostRef.current.clientWidth * playheadFraction;
    scrollHostRef.current.scrollLeft = Math.max(0, target);
  }, [currentTime, timeline, beatTimes, config, offsetSec]);

  const stats = useMemo(() => beatWidthStats(timeline), [timeline]);
  const audioOffsetText = audioOffset > 0 ? ` · pickup ${audioOffset.toFixed(2)}s before downbeat` : '';

  return (
    <div style={cardStyle}>
      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <span style={meta}>
          {fmt(currentTime)} / {fmt(duration)}{audioOffsetText}
        </span>
      </Toolbar>

      <div style={{ position: 'relative' }}>
        <InfiniteScrollRenderer
          url={scoreUrl}
          height={210}
          zoom={0.9}
          onReady={handleReady}
          onTimeline={handleTimeline}
        />
        {/* Fixed playhead overlay — horizontal-percent inside the scroll viewport */}
        <Playhead leftFraction={playheadFraction} />
      </div>

      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={currentTime}
        onChange={(e) => seek(parseFloat(e.target.value))}
        style={{ width: '100%', marginTop: 8 }}
      />

      <audio ref={audioRef} preload="metadata" src={audioUrl} style={{ display: 'none' }} />

      {timeline.length > 0 && (
        <div style={statsBar}>
          <span><strong>{timeline.length}</strong> cursor steps</span>
          <span>px-per-beat: <strong>{stats.minPxPerBeat.toFixed(0)}</strong> – <strong>{stats.maxPxPerBeat.toFixed(0)}</strong>
            {' '}(mean {stats.meanPxPerBeat.toFixed(0)}, σ {stats.stddev.toFixed(0)})</span>
        </div>
      )}
    </div>
  );
}

function Playhead({ leftFraction }: { leftFraction: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${leftFraction * 100}%`,
        width: 2,
        background: 'rgba(217, 70, 239, 0.85)',
        pointerEvents: 'none',
        boxShadow: '0 0 8px rgba(217,70,239,0.6)',
        zIndex: 5,
      }}
    />
  );
}

// --- shared atoms used across the page's widgets ---

export function findCursorIdx(beat: number, timeline: InfiniteBeatStamp[]): number {
  if (timeline.length === 0) return 0;
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (timeline[mid].absoluteBeat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Full-bleed breakout: widgets extend past the 820px prose column so the
// reader sees more of the score. `position: relative` + `left: 50%` +
// `translateX(-50%)` centers the widget against the viewport instead of
// the prose column; width caps at 1400px so it stays readable on ultrawides.
export const cardStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  padding: '0.8rem',
  margin: '1.5rem 0',
  width: 'min(1400px, calc(100vw - 2em))',
  maxWidth: 'none',
  position: 'relative',
  left: '50%',
  transform: 'translateX(-50%)',
  boxSizing: 'border-box',
};

export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

export function btn(active: boolean): React.CSSProperties {
  return {
    padding: '0.35rem 0.9rem',
    background: active ? 'var(--accent, #6B9FD6)' : 'var(--bg-elevated)',
    color: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9em',
  };
}

export const meta: React.CSSProperties = {
  fontSize: '0.78em',
  color: 'var(--text-secondary)',
  fontVariantNumeric: 'tabular-nums',
};

export const statsBar: React.CSSProperties = {
  display: 'flex',
  gap: '1.4rem',
  flexWrap: 'wrap',
  fontSize: '0.75em',
  color: 'var(--text-secondary)',
  marginTop: 8,
  padding: '0.4rem 0.6rem',
  background: 'var(--bg-elevated)',
  borderRadius: 4,
  fontVariantNumeric: 'tabular-nums',
};

export function fmt(s: number): string {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}
