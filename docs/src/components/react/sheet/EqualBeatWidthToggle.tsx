import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, beatWidthStats, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import { secondsToBeat, buildBeatTimes, type WiggleConfig, type BeatTime } from './wiggleSync';
import { findCursorIdx, cardStyle, Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

/**
 * Widget 4 — Natural vs equal-beat-width layout, side-by-side, in lockstep.
 *
 * Both renderers receive the same audio time. With OSMD's natural layout,
 * dense measures take more horizontal space than sparse ones, so the scroll
 * speed visibly varies. With FixedMeasureWidth = true, every measure
 * occupies the same width — scroll speed becomes nearly constant.
 *
 * The numerical proof: we measure px-per-beat across all cursor steps and
 * report (min, max, σ). At 132 BPM, scroll velocity is roughly
 *    (px-per-beat) × (BPM / 60) px/sec.
 * Stable σ → predictable visual flow.
 */
export function EqualBeatWidthToggle({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [naturalTl, setNaturalTl] = useState<InfiniteBeatStamp[]>([]);
  const [equalTl, setEqualTl] = useState<InfiniteBeatStamp[]>([]);
  const naturalRef = useRef<HTMLDivElement | null>(null);
  const equalRef = useRef<HTMLDivElement | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);

  const handleNaturalReady = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) naturalRef.current = osmd.container.parentElement;
  }, []);
  const handleEqualReady = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) equalRef.current = osmd.container.parentElement;
  }, []);

  // Drive both viewports from the same audio
  useEffect(() => {
    const scoreBeat = config ? secondsToBeat(currentTime + offsetSec, beatTimes, 120) : 0;
    drive(scoreBeat, naturalTl, naturalRef.current, playheadFraction);
    drive(scoreBeat, equalTl, equalRef.current, playheadFraction);
  }, [currentTime, naturalTl, equalTl, beatTimes, config, offsetSec]);

  const naturalStats = useMemo(() => beatWidthStats(naturalTl), [naturalTl]);
  const equalStats = useMemo(() => beatWidthStats(equalTl), [equalTl]);

  // Approx scroll velocity at 132 BPM
  const bpm = 132;
  const beatsPerSec = bpm / 60;
  const naturalVel = `${(naturalStats.minPxPerBeat * beatsPerSec).toFixed(0)}–${(naturalStats.maxPxPerBeat * beatsPerSec).toFixed(0)} px/sec`;
  const equalVel = `${(equalStats.minPxPerBeat * beatsPerSec).toFixed(0)}–${(equalStats.maxPxPerBeat * beatsPerSec).toFixed(0)} px/sec`;

  return (
    <div style={cardStyle}>
      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)} · both viewports drive from this clock</span>
      </Toolbar>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <Pane label="Natural (OSMD default)">
          <InfiniteScrollRenderer url={scoreUrl} height={170} zoom={0.85}
            equalBeatWidth={false}
            onReady={handleNaturalReady}
            onTimeline={setNaturalTl} />
          <Stats stats={naturalStats} velocity={naturalVel} />
        </Pane>
        <Pane label="Equal-beat-width (FixedMeasureWidth = true)">
          <InfiniteScrollRenderer url={scoreUrl} height={170} zoom={0.85}
            equalBeatWidth={true}
            onReady={handleEqualReady}
            onTimeline={setEqualTl} />
          <Stats stats={equalStats} velocity={equalVel} />
        </Pane>
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
    </div>
  );
}

function Pane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.78em', color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ position: 'relative' }}>
        {children}
        <div style={{
          position: 'absolute', top: 0, bottom: 30,
          left: '35%', width: 2, background: 'rgba(217, 70, 239, 0.85)',
          pointerEvents: 'none', boxShadow: '0 0 8px rgba(217,70,239,0.6)', zIndex: 5,
        }} />
      </div>
    </div>
  );
}

function Stats({ stats, velocity }: { stats: ReturnType<typeof beatWidthStats>; velocity: string }) {
  const variance = stats.minPxPerBeat > 0 ? (stats.maxPxPerBeat / stats.minPxPerBeat) : 0;
  return (
    <div style={{
      display: 'flex', gap: '1.2rem', flexWrap: 'wrap',
      fontSize: '0.72em', color: 'var(--text-secondary)',
      marginTop: 4, padding: '0.3rem 0.5rem',
      background: 'var(--bg-elevated)', borderRadius: 4,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <span>px/beat: <strong>{stats.minPxPerBeat.toFixed(0)}</strong>–<strong>{stats.maxPxPerBeat.toFixed(0)}</strong></span>
      <span>σ <strong>{stats.stddev.toFixed(0)}</strong></span>
      <span>variance ratio <strong>{variance.toFixed(1)}×</strong></span>
      <span>scroll @ 132 BPM ≈ <strong>{velocity}</strong></span>
    </div>
  );
}

function drive(
  scoreBeat: number,
  timeline: InfiniteBeatStamp[],
  scrollHost: HTMLDivElement | null,
  playheadFraction: number,
) {
  if (!scrollHost || timeline.length === 0) return;
  const idx = findCursorIdx(scoreBeat, timeline);
  const stamp = timeline[idx];
  if (!stamp) return;
  const next = timeline[idx + 1];
  let xPx = stamp.xPx;
  if (next) {
    const dBeat = next.absoluteBeat - stamp.absoluteBeat;
    if (dBeat > 0) {
      const frac = Math.max(0, Math.min(1, (scoreBeat - stamp.absoluteBeat) / dBeat));
      xPx = stamp.xPx + frac * (next.xPx - stamp.xPx);
    }
  }
  scrollHost.scrollLeft = Math.max(0, xPx - scrollHost.clientWidth * playheadFraction);
}
