import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import { measureStartTimes, currentMeasureIndex, type WiggleConfig } from './wiggleSync';
import { useTapMapOffset } from './tapMapOffsetStore';
import { cardStyle, Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

/**
 * Widget 1¾ — Barline-to-barline cursor.
 *
 * Widget 1 and friends drive the cursor off *every* tapMap onset (beats
 * and measures both). That gives sub-beat precision but also inherits
 * every little tapping inaccuracy: the cursor speeds up and slows down
 * as the tapper's timing wobbles.
 *
 * This widget throws the beats away. Only `measure` and `section` taps
 * matter. Between any two consecutive measure taps we interpolate the
 * cursor linearly from `measureXs[i]` to `measureXs[i+1]`, timed by the
 * tapMap's own interval. The cursor therefore moves at a perfectly
 * constant velocity *within* each measure, with a velocity jump at each
 * barline when the next measure's tempo differs.
 *
 * Tradeoff: you lose the "tight to every note onset" feel, but you gain
 * a predictable sweep that the ear actually tracks — because musicians
 * perceive tempo at the bar level, not the beat level, on most material.
 */
export function BarlineCursorDemo({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const measureTimes = useMemo<number[]>(
    () => (config ? measureStartTimes(config) : []),
    [config],
  );

  const handleReady = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) scrollHostRef.current = osmd.container.parentElement;
  }, []);

  // Derived readout for the toolbar — current segment bounds
  const effectiveTime = currentTime + offsetSec;
  const curIdx = measureTimes.length > 0 ? currentMeasureIndex(effectiveTime, measureTimes) : 0;
  const segStart = measureTimes[curIdx] ?? 0;
  const segEnd = measureTimes[curIdx + 1] ?? segStart;
  const segDuration = Math.max(0.001, segEnd - segStart);
  const segFrac = Math.max(0, Math.min(1, (effectiveTime - segStart) / segDuration));

  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host || measureXs.length < 2 || measureTimes.length < 2) return;

    const x0 = measureXs[curIdx];
    const x1 = measureXs[curIdx + 1] ?? x0;
    const cursorX = x0 + segFrac * (x1 - x0);
    host.scrollLeft = Math.max(0, cursorX - host.clientWidth * playheadFraction);
  }, [curIdx, segFrac, measureXs, measureTimes.length]);

  const segVelocity = segDuration > 0 && measureXs[curIdx + 1] != null
    ? Math.abs((measureXs[curIdx + 1] - measureXs[curIdx]) / segDuration)
    : 0;

  return (
    <div style={cardStyle}>
      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)}</span>
        <span style={meta}>
          · m. {curIdx + 1} · {(segFrac * 100).toFixed(0)}% through · seg {segDuration.toFixed(2)}s · {segVelocity.toFixed(0)} px/sec
        </span>
      </Toolbar>

      <div style={{ position: 'relative' }}>
        <InfiniteScrollRenderer
          url={scoreUrl}
          height={210}
          zoom={0.9}
          onReady={handleReady}
          onTimeline={setTimeline}
          onMeasureXs={setMeasureXs}
        />
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

      <div style={{ marginTop: 8, fontSize: '0.72em', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        Cursor position = <code>lerp(measureXs[m], measureXs[m+1], (t − t_m) / (t_m+1 − t_m))</code>, where m is the current measure and t values come from tapMap measure/section entries. Within each measure the cursor moves at a constant velocity shown in the toolbar; at each barline the velocity jumps to match the next measure's duration. {timeline.length > 0 && `Timeline has ${timeline.length} onsets; they're ignored here — only the ${measureTimes.length} measure taps drive the motion.`}
      </div>
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
