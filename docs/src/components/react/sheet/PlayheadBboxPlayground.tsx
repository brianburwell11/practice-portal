import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import { secondsToBeat, buildBeatTimes, measureStartTimes, currentMeasureIndex, type WiggleConfig, type BeatTime } from './wiggleSync';
import { findCursorIdx, cardStyle, Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

type HeightMode = 'capo' | 'staff' | 'system';
type Snappiness = 'snappy' | 'smooth' | 'measure';
type BeatsSpanned = 0 | 1 | 2 | 4 | 8 | 'measure';
type BboxAnchor = 'start' | 'center';

/**
 * Widget 3 — Playhead bbox configurator.
 *
 * The "you are here" indicator: a translucent rectangle painted over the
 * sheet music at the current playback position. Configurable knobs:
 *   - height: thin capo stripe, full staff height, or full system height
 *   - color: hex color
 *   - opacity: 0..1
 *   - beats spanned: 1, 2, 4 (full measure of 4/4), 8 — wider boxes are
 *     a "what's coming up" preview rather than a strict pointer
 *   - snappiness: snappy = jumps to the next beat at each beat boundary,
 *     smooth = continuous interpolation across the score
 */
export function PlayheadBboxPlayground({ scoreUrl, audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);
  const [heightMode, setHeightMode] = useState<HeightMode>('staff');
  const [color, setColor] = useState('#22D3EE');
  const [opacity, setOpacity] = useState(0.28);
  const [beatsSpanned, setBeatsSpanned] = useState<BeatsSpanned>(1);
  const [snappiness, setSnappiness] = useState<Snappiness>('smooth');
  const [bboxAnchor, setBboxAnchor] = useState<BboxAnchor>('start');

  const osmdRef = useRef<any>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const containerWrapRef = useRef<HTMLDivElement | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(audioUrl);
  const [offsetSec] = useTapMapOffset();

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);
  const measureTimes = useMemo<number[]>(() => (config ? measureStartTimes(config) : []), [config]);

  const handleReady = useCallback((osmd: any) => {
    osmdRef.current = osmd;
    if (osmd?.container?.parentElement) {
      scrollHostRef.current = osmd.container.parentElement;
    }
  }, []);
  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);

  // Compute the bbox's score-x and score-width based on current beat
  const bbox = useMemo(() => {
    if (timeline.length === 0) return null;

    // Measure-snap mode: highlight the whole current measure, jump on
    // measure boundaries. Driven by tapMap's measure/section taps.
    // Uses `measureXs` (actual barline positions from OSMD) rather than
    // first-note-onset cursor x's so the bbox edges land on the barlines.
    if (snappiness === 'measure' && measureTimes.length > 0) {
      const measureIdx = currentMeasureIndex(currentTime + offsetSec, measureTimes);
      const firstStamp = timeline.find((s) => s.measureIndex === measureIdx);
      if (!firstStamp) return null;
      const leftX = measureXs[measureIdx] ?? firstStamp.xPx;
      const rightX = measureXs[measureIdx + 1]
        ?? timeline.find((s) => s.measureIndex === measureIdx + 1)?.xPx
        ?? (timeline[timeline.length - 1].xPx + timeline[timeline.length - 1].widthPx);
      const widthPx = Math.max(20, rightX - leftX);
      return { xPx: leftX, widthPx, scoreBeat: firstStamp.absoluteBeat, measureIndex: measureIdx };
    }

    const scoreBeat = config ? secondsToBeat(currentTime + offsetSec, beatTimes, 120) : 0;
    const idx = findCursorIdx(scoreBeat, timeline);
    const stamp = timeline[idx];
    if (!stamp) return null;
    const next = timeline[idx + 1];
    let xPx: number;
    if (snappiness === 'snappy') {
      xPx = stamp.xPx;
    } else if (next) {
      const dBeat = next.absoluteBeat - stamp.absoluteBeat;
      const frac = dBeat > 0 ? Math.max(0, Math.min(1, (scoreBeat - stamp.absoluteBeat) / dBeat)) : 0;
      xPx = stamp.xPx + frac * (next.xPx - stamp.xPx);
    } else {
      xPx = stamp.xPx;
    }

    // End-x: "one whole measure" uses this measure's beat count; otherwise
    // walk forward literal N beats. Interpolate the result so the right edge
    // lands exactly on the target beat rather than overshooting to the next
    // cursor stamp.
    // If the bbox spans "one whole measure", snap both edges to actual
    // barline x's instead of walking N beats from the cursor — this is what
    // the musician expects to see framing each measure.
    if (beatsSpanned === 'measure') {
      const leftX = measureXs[stamp.measureIndex] ?? stamp.xPx;
      const rightX = measureXs[stamp.measureIndex + 1]
        ?? timeline.find((s) => s.measureIndex === stamp.measureIndex + 1)?.xPx
        ?? (stamp.xPx + stamp.widthPx);
      const widthPx = Math.max(20, rightX - leftX);
      return { xPx: leftX, widthPx, scoreBeat, measureIndex: stamp.measureIndex };
    }

    // 0 beats = hidden bbox — easy toggle for "just show the playhead line"
    if (beatsSpanned === 0) {
      return { xPx, widthPx: 0, scoreBeat, measureIndex: stamp.measureIndex };
    }

    const startBeat = snappiness === 'snappy' ? stamp.absoluteBeat : scoreBeat;
    const endBeat = startBeat + (beatsSpanned as number);
    const endX = beatToX(endBeat, timeline);
    const widthPx = Math.max(20, endX - xPx);
    return { xPx, widthPx, scoreBeat, measureIndex: stamp.measureIndex };
  }, [timeline, measureXs, currentTime, beatTimes, measureTimes, snappiness, beatsSpanned, config, offsetSec]);

  // Scroll sync: keep the bbox's left edge under the fixed playhead
  useEffect(() => {
    if (!bbox || !scrollHostRef.current) return;
    const target = bbox.xPx - scrollHostRef.current.clientWidth * playheadFraction;
    scrollHostRef.current.scrollLeft = Math.max(0, target);
  }, [bbox]);

  const heightLabel: Record<HeightMode, string> = {
    capo: '4px capo stripe',
    staff: 'staff height',
    system: 'full system',
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem 1.4rem', marginBottom: '0.6rem', fontSize: '0.85em' }}>
        <Field label={`Height — ${heightLabel[heightMode]}`}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['capo', 'staff', 'system'] as HeightMode[]).map((m) => (
              <button key={m} onClick={() => setHeightMode(m)} style={btn(heightMode === m)}>{m}</button>
            ))}
          </div>
        </Field>
        <Field label={`Color — ${color}`}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
            style={{ width: '100%', height: 30, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent' }} />
        </Field>
        <Field label={`Opacity — ${(opacity * 100).toFixed(0)}%`}>
          <input type="range" min={0} max={1} step={0.02} value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </Field>
        <Field label={`Beats spanned — ${beatsSpanned}`}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {([0, 1, 2, 4, 8, 'measure'] as BeatsSpanned[]).map((n) => (
              <button key={String(n)} onClick={() => setBeatsSpanned(n)} style={btn(beatsSpanned === n)}>{n}</button>
            ))}
          </div>
        </Field>
        <Field label={`Snappiness — ${snappiness}`}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['snappy', 'smooth', 'measure'] as Snappiness[]).map((s) => (
              <button key={s} onClick={() => setSnappiness(s)} style={btn(snappiness === s)}>{s}</button>
            ))}
          </div>
        </Field>
        <Field label={`Playhead in box — ${bboxAnchor}`}>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['start', 'center'] as BboxAnchor[]).map((a) => (
              <button key={a} onClick={() => setBboxAnchor(a)} style={btn(bboxAnchor === a)}>{a}</button>
            ))}
          </div>
        </Field>
      </div>

      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)} · m. {(bbox?.measureIndex ?? 0) + 1}</span>
      </Toolbar>

      <div ref={containerWrapRef} style={{ position: 'relative' }}>
        <InfiniteScrollRenderer url={scoreUrl} height={210} zoom={0.9}
          onReady={handleReady} onTimeline={handleTimeline} onMeasureXs={setMeasureXs} />
        {/* Static playhead line — colored and wider so it's still a useful
            indicator when the bbox is hidden (width 0) or highly transparent. */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `calc(${playheadFraction * 100}% - 1px)`,
          width: 2, background: color,
          opacity: 0.9,
          boxShadow: `0 0 6px ${hexToRgba(color, 0.6)}`,
          pointerEvents: 'none', zIndex: 5,
        }} />
        {/* The bbox itself — anchored at the playhead, width spanning N beats forward */}
        {bbox && (
          <BboxOverlay
            leftFraction={playheadFraction}
            widthPx={bbox.widthPx}
            heightMode={heightMode}
            color={color}
            opacity={opacity}
            anchor={bboxAnchor}
          />
        )}
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

/** Map a (fractional) absolute beat to its pixel x by interpolating between
 * the bracketing cursor stamps. Returns a value in scroll-host coordinates. */
function beatToX(beat: number, timeline: InfiniteBeatStamp[]): number {
  if (timeline.length === 0) return 0;
  const idx = findCursorIdx(beat, timeline);
  const stamp = timeline[idx];
  if (!stamp) return 0;
  const next = timeline[idx + 1];
  if (!next) return stamp.xPx + stamp.widthPx;
  const dBeat = next.absoluteBeat - stamp.absoluteBeat;
  if (dBeat <= 0) return stamp.xPx;
  const frac = Math.max(0, Math.min(1, (beat - stamp.absoluteBeat) / dBeat));
  return stamp.xPx + frac * (next.xPx - stamp.xPx);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2, fontSize: '0.85em' }}>{label}</div>
      {children}
    </label>
  );
}

function BboxOverlay({
  leftFraction,
  widthPx,
  heightMode,
  color,
  opacity,
  anchor,
}: {
  leftFraction: number;
  widthPx: number;
  heightMode: HeightMode;
  color: string;
  opacity: number;
  anchor: BboxAnchor;
}) {
  // Heights are heuristics for the strip-style renderer (210px tall @ zoom 0.9).
  // 'system' sits on the staves (not above them); 'staff' covers the first staff;
  // 'capo' is a thin stripe at the very top.
  const top = heightMode === 'capo' ? 0 : heightMode === 'staff' ? 50 : 28;
  const height = heightMode === 'capo' ? 6 : heightMode === 'staff' ? 70 : 178;
  // `start` anchor: left edge sits at the playhead → bbox extends right.
  // `center` anchor: center sits at the playhead → bbox extends equally both ways.
  // Borders also flip so the visible edge marker aligns with the playhead side.
  const offsetPx = anchor === 'center' ? widthPx / 2 : 0;
  // width 0 → render nothing visible (no bg, no border)
  const border = widthPx <= 0 || anchor === 'center'
    ? { /* no border — playhead line inside the box marks the center, or zero-width hides the box */ }
    : { borderLeft: `2px solid ${color}` };
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${leftFraction * 100}% - ${offsetPx}px)`,
        top,
        width: widthPx,
        height,
        background: hexToRgba(color, opacity),
        ...border,
        borderRadius: 2,
        pointerEvents: 'none',
        zIndex: 6,
        transition: 'width 80ms linear, left 80ms linear',
      }}
    />
  );
}

function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
