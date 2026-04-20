import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfiniteScrollRenderer, beatWidthStats, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { useAudioPlayhead } from './useAudioPlayhead';
import {
  secondsToBeat, buildBeatTimes, measureStartTimes, currentMeasureIndex,
  type WiggleConfig, type BeatTime,
} from './wiggleSync';
import { findCursorIdx, cardStyle, Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  scoreUrl: string;
  audioUrl: string;
  configUrl: string;
}

type TrackingMode = 'karaoke' | 'window' | 'trainTrack' | 'hybrid';
type HeightMode = 'capo' | 'staff' | 'system';
type Snappiness = 'smooth' | 'snappy' | 'measure';
type BeatsSpanned = 0 | 1 | 2 | 4 | 8 | 'measure';
type CursorGranularity = 'beat' | 'measure';
type BboxAnchor = 'start' | 'center';

interface StemOption { label: string; url: string; }

/**
 * Widget 6 — The integrated playground.
 *
 * Combines every knob from every widget on the page against one audio
 * source, so the reader can find their preferred setup and see it all
 * interact:
 *
 *   - Sync        — stem picker, tapMap nudge (widget 0),
 *                   cursor granularity beat/measure (widget 1¾),
 *                   barline nudge px (widget 1½)
 *   - Layout      — zoom (widget 2), equal-beat-width (widget 4)
 *   - Tracking    — karaoke / window / trainTrack / hybrid (widget 5),
 *                   window bars slider
 *   - Playhead    — height, color, opacity, beats-spanned 1/2/4/8/measure,
 *                   snappiness smooth/snappy/measure (widget 3)
 *   - Debug       — overlay that draws the detected measure lines
 *                   (widget 1½)
 *
 * Every knob is persisted to localStorage (per-key). The tapMap nudge
 * lives in its own shared store so dialing it in here also affects every
 * other widget on the page — same as dialing it in on widget 0.
 */
export function UxIntegratedPlayground({ scoreUrl, audioUrl, configUrl }: Props) {
  const stemOptions = useMemo<StemOption[]>(() => buildStemOptions(audioUrl), [audioUrl]);

  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);

  // Persisted per-widget settings
  const [stemUrl, setStemUrl] = usePersisted('ux-pg.stem', stemOptions[0].url);
  const [zoom, setZoom] = usePersisted('ux-pg.zoom', 0.95);
  const [equalBeatWidth, setEqualBeatWidth] = usePersisted('ux-pg.ebw', false);
  const [trackingMode, setTrackingMode] = usePersisted<TrackingMode>('ux-pg.mode', 'karaoke');
  const [windowBars, setWindowBars] = usePersisted('ux-pg.bars', 4);
  const [heightMode, setHeightMode] = usePersisted<HeightMode>('ux-pg.h', 'staff');
  const [color, setColor] = usePersisted('ux-pg.color', '#22D3EE');
  const [opacity, setOpacity] = usePersisted('ux-pg.op', 0.28);
  const [beatsSpanned, setBeatsSpanned] = usePersisted<BeatsSpanned>('ux-pg.bs', 1);
  const [snappiness, setSnappiness] = usePersisted<Snappiness>('ux-pg.snap', 'smooth');
  const [granularity, setGranularity] = usePersisted<CursorGranularity>('ux-pg.gran', 'beat');
  const [barlineNudgePx, setBarlineNudgePx] = usePersisted('ux-pg.barNudge', 0);
  const [bboxAnchor, setBboxAnchor] = usePersisted<BboxAnchor>('ux-pg.anchor', 'start');
  const [showDebug, setShowDebug] = usePersisted('ux-pg.debug', false);

  // Shared across all widgets on the page
  const [offsetSec, setOffsetSec] = useTapMapOffset();

  const scrollHostRef = useRef<HTMLDivElement | null>(null);
  const [windowAnchor, setWindowAnchor] = useState(0);
  const [trainAnchor, setTrainAnchor] = useState(0);
  const [hybridAnchor, setHybridAnchor] = useState(0);
  const [bboxLeftPx, setBboxLeftPx] = useState<number | null>(null);
  const [bboxWidthPx, setBboxWidthPx] = useState(40);
  const [trainGrayPx, setTrainGrayPx] = useState(0);
  const [trainGrayRightStartPx, setTrainGrayRightStartPx] = useState<number | null>(null);
  const playheadFraction = 0.35;
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(stemUrl);

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl).then((r) => r.json()).then((j) => { if (!cancelled) setConfig(j); });
    return () => { cancelled = true; };
  }, [configUrl]);

  const beatTimes = useMemo<BeatTime[]>(() => (config ? buildBeatTimes(config) : []), [config]);
  const measureTimes = useMemo<number[]>(() => (config ? measureStartTimes(config) : []), [config]);

  const handleReady = useCallback((osmd: any) => {
    if (osmd?.container?.parentElement) scrollHostRef.current = osmd.container.parentElement;
  }, []);
  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);
  const handleMeasureXs = useCallback((xs: number[]) => setMeasureXs(xs), []);

  // Apply the user's barline nudge to every measure x for all downstream math
  const nudgedMeasureXs = useMemo(
    () => measureXs.map((x) => x + barlineNudgePx),
    [measureXs, barlineNudgePx],
  );

  const cursorXAtBeat = useCallback((beat: number, snap: boolean): number => {
    if (timeline.length === 0) return 0;
    const idx = findCursorIdx(beat, timeline);
    const stamp = timeline[idx];
    if (snap) return stamp.xPx;
    const next = timeline[idx + 1];
    if (!next) return stamp.xPx;
    const dBeat = next.absoluteBeat - stamp.absoluteBeat;
    if (dBeat <= 0) return stamp.xPx;
    const frac = Math.max(0, Math.min(1, (beat - stamp.absoluteBeat) / dBeat));
    return stamp.xPx + frac * (next.xPx - stamp.xPx);
  }, [timeline]);

  const measureXAt = useCallback((measureIdx: number): number => {
    const m = Math.floor(measureIdx);
    const a = nudgedMeasureXs[m];
    if (a == null) return 0;
    const b = nudgedMeasureXs[m + 1];
    if (b == null) return a;
    const frac = measureIdx - m;
    return a + frac * (b - a);
  }, [nudgedMeasureXs]);

  // Big sync effect: compute cursor x, scroll, bbox, per tracking mode
  useEffect(() => {
    const host = scrollHostRef.current;
    if (!host || timeline.length === 0) return;

    const effTime = currentTime + offsetSec;

    // ---- cursor x --------------------------------------------------------
    // Beat granularity: every tapMap onset drives the cursor (sub-beat precision)
    // Measure granularity: only measure/section taps; lerp between barlines
    let cursorAbsX: number;
    let measureIdx: number;
    if (granularity === 'measure' && measureTimes.length > 1 && nudgedMeasureXs.length > 1) {
      measureIdx = currentMeasureIndex(effTime, measureTimes);
      const t0 = measureTimes[measureIdx];
      const t1 = measureTimes[measureIdx + 1] ?? t0 + 1;
      const frac = Math.max(0, Math.min(1, (effTime - t0) / Math.max(0.001, t1 - t0)));
      const x0 = nudgedMeasureXs[measureIdx];
      const x1 = nudgedMeasureXs[measureIdx + 1] ?? x0;
      cursorAbsX = x0 + frac * (x1 - x0);
    } else {
      const scoreBeat = config ? secondsToBeat(effTime, beatTimes, 120) : 0;
      cursorAbsX = cursorXAtBeat(scoreBeat, snappiness === 'snappy');
      const idx = findCursorIdx(scoreBeat, timeline);
      measureIdx = timeline[idx]?.measureIndex ?? 0;
    }

    // ---- bbox bounds -----------------------------------------------------
    let bboxX = cursorAbsX;
    let bboxW = 40;
    if (snappiness === 'measure' && nudgedMeasureXs.length > 1) {
      const l = nudgedMeasureXs[measureIdx] ?? cursorAbsX;
      const r = nudgedMeasureXs[measureIdx + 1] ?? (l + 120);
      bboxX = l;
      bboxW = Math.max(20, r - l);
    } else if (beatsSpanned === 'measure') {
      const l = nudgedMeasureXs[measureIdx] ?? cursorAbsX;
      const r = nudgedMeasureXs[measureIdx + 1] ?? (l + 120);
      bboxX = snappiness === 'snappy' ? l : cursorAbsX;
      bboxW = Math.max(20, r - bboxX);
    } else if (beatsSpanned === 0) {
      // 0 beats = hidden bbox — easy toggle for "just show the playhead line"
      bboxX = cursorAbsX;
      bboxW = 0;
    } else {
      // Fixed-N-beats bbox, interpolated right edge
      const scoreBeat = config ? secondsToBeat(effTime, beatTimes, 120) : 0;
      const idx = findCursorIdx(scoreBeat, timeline);
      const stamp = timeline[idx];
      const startBeat = snappiness === 'snappy' ? stamp.absoluteBeat : scoreBeat;
      const endBeat = startBeat + (beatsSpanned as number);
      const endX = cursorXAtBeat(endBeat, false);
      bboxX = cursorAbsX;
      bboxW = Math.max(20, endX - cursorAbsX);
    }
    setBboxWidthPx(bboxW);

    // ---- tracking mode → scrollLeft + bbox viewport position --------------
    if (trackingMode === 'karaoke') {
      host.scrollLeft = Math.max(0, cursorAbsX - host.clientWidth * playheadFraction);
      setBboxLeftPx(bboxX - host.scrollLeft - (bboxAnchor === 'center' ? bboxW / 2 : 0));
      setTrainGrayPx(0);
      setTrainGrayRightStartPx(null);
    } else if (trackingMode === 'window' || trackingMode === 'trainTrack') {
      let anchor = trackingMode === 'window' ? windowAnchor : trainAnchor;
      if (measureIdx < anchor || measureIdx >= anchor + windowBars) {
        anchor = Math.floor(measureIdx / windowBars) * windowBars;
        if (trackingMode === 'window') setWindowAnchor(anchor); else setTrainAnchor(anchor);
      }
      const anchorX = measureXAt(anchor);
      if (trackingMode === 'trainTrack') {
        const prevBarStartX = anchor > 0 ? measureXAt(anchor - 1) : anchorX;
        const halfPrev = anchor > 0 ? (anchorX - prevBarStartX) / 2 : 0;
        host.scrollLeft = Math.max(0, anchorX - halfPrev);
        setTrainGrayPx(halfPrev);
        // Gray everything past the N-bar window — the start of the measure
        // after the window is the page-snap boundary.
        const rightEndX = measureXAt(anchor + windowBars);
        setTrainGrayRightStartPx(rightEndX - host.scrollLeft);
      } else {
        host.scrollLeft = Math.max(0, anchorX);
        setTrainGrayPx(0);
        setTrainGrayRightStartPx(null);
      }
      setBboxLeftPx(bboxX - host.scrollLeft - (bboxAnchor === 'center' ? bboxW / 2 : 0));
    } else {
      // hybrid — follow-zone edges
      const viewportW = host.clientWidth;
      const leftXNow = measureXAt(hybridAnchor);
      const playheadPx = cursorAbsX - leftXNow;
      const followZone = 0.15;
      let nextAnchor = hybridAnchor;
      if (playheadPx > viewportW * (1 - followZone)) {
        const overshoot = playheadPx - viewportW * (1 - followZone);
        const pxPerMeasure = estimateLocalPxPerMeasure(nudgedMeasureXs, hybridAnchor);
        nextAnchor = hybridAnchor + overshoot / pxPerMeasure;
      } else if (playheadPx < viewportW * followZone && hybridAnchor > 0) {
        const undershoot = viewportW * followZone - playheadPx;
        const pxPerMeasure = estimateLocalPxPerMeasure(nudgedMeasureXs, hybridAnchor);
        nextAnchor = Math.max(0, hybridAnchor - undershoot / pxPerMeasure);
      }
      if (Math.abs(nextAnchor - hybridAnchor) > 0.001) setHybridAnchor(nextAnchor);
      const leftX = measureXAt(nextAnchor);
      host.scrollLeft = Math.max(0, leftX);
      setBboxLeftPx(bboxX - host.scrollLeft - (bboxAnchor === 'center' ? bboxW / 2 : 0));
      setTrainGrayPx(0);
      setTrainGrayRightStartPx(null);
    }
  }, [
    currentTime, timeline, nudgedMeasureXs, measureTimes, beatTimes, config,
    trackingMode, windowBars, windowAnchor, trainAnchor, hybridAnchor,
    beatsSpanned, snappiness, granularity, offsetSec, bboxAnchor,
    cursorXAtBeat, measureXAt,
  ]);

  const stats = useMemo(() => beatWidthStats(timeline), [timeline]);
  const totalHeight = Math.max(180, 220 * zoom);

  // Debug overlay lines
  const debugOverlay = showDebug ? (
    <>
      {nudgedMeasureXs.map((x, i) => (
        <div key={`m${i}`} style={{
          position: 'absolute', top: 0, left: x, width: 1.5, height: totalHeight,
          background: 'rgba(236,72,153,0.75)', pointerEvents: 'none', zIndex: 4,
        }}>
          <span style={debugLabelStyle}>m{i + 1}</span>
        </div>
      ))}
    </>
  ) : null;

  return (
    <div style={cardStyle}>
      {/* Controls grid */}
      <div style={controlsGrid}>
        <Sec title="Sync">
          <Field label="stem">
            <select value={stemUrl} onChange={(e) => setStemUrl(e.target.value)} style={selectStyle}>
              {stemOptions.map((s) => <option key={s.url} value={s.url}>{s.label}</option>)}
            </select>
          </Field>
          <Field label={`tapMap nudge · ${offsetSec >= 0 ? '+' : ''}${offsetSec.toFixed(2)}s`}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="range" min={-3} max={3} step={0.01} value={offsetSec}
                onChange={(e) => setOffsetSec(parseFloat(e.target.value))} style={fullW} />
              <button onClick={() => setOffsetSec(0)} style={{ ...btn(false), padding: '0.15rem 0.4rem', fontSize: '0.7em' }}>0</button>
            </div>
          </Field>
          <Field label="cursor granularity">
            <div style={btnRow}>
              {(['beat', 'measure'] as CursorGranularity[]).map((g) => (
                <button key={g} onClick={() => setGranularity(g)} style={btn(granularity === g)}>{g}</button>
              ))}
            </div>
          </Field>
          <Field label={`barline nudge · ${barlineNudgePx >= 0 ? '+' : ''}${barlineNudgePx}px`}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="range" min={-40} max={40} step={1} value={barlineNudgePx}
                onChange={(e) => setBarlineNudgePx(parseInt(e.target.value, 10))} style={fullW} />
              <button onClick={() => setBarlineNudgePx(0)} style={{ ...btn(false), padding: '0.15rem 0.4rem', fontSize: '0.7em' }}>0</button>
            </div>
          </Field>
        </Sec>

        <Sec title="Layout">
          <Field label={`zoom · ${(zoom * 100).toFixed(0)}%`}>
            <input type="range" min={0.4} max={1.8} step={0.05} value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))} style={fullW} />
          </Field>
          <Field label="beat-width">
            <div style={btnRow}>
              <button onClick={() => setEqualBeatWidth(false)} style={btn(!equalBeatWidth)}>natural</button>
              <button onClick={() => setEqualBeatWidth(true)} style={btn(equalBeatWidth)}>equal</button>
            </div>
          </Field>
        </Sec>

        <Sec title="Tracking">
          <Field label="mode">
            <div style={btnRow}>
              {(['karaoke', 'window', 'trainTrack', 'hybrid'] as TrackingMode[]).map((m) => (
                <button key={m} onClick={() => setTrackingMode(m)} style={btn(trackingMode === m)}>{m}</button>
              ))}
            </div>
          </Field>
          {trackingMode !== 'karaoke' && (
            <Field label={`window — ${windowBars} bars`}>
              <input type="range" min={2} max={8} step={1} value={windowBars}
                onChange={(e) => setWindowBars(parseInt(e.target.value))} style={fullW} />
            </Field>
          )}
        </Sec>

        <Sec title="Playhead bbox">
          <Field label="height">
            <div style={btnRow}>
              {(['capo', 'staff', 'system'] as HeightMode[]).map((m) => (
                <button key={m} onClick={() => setHeightMode(m)} style={btn(heightMode === m)}>{m}</button>
              ))}
            </div>
          </Field>
          <Field label={`color · ${color}`}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              style={{ ...fullW, height: 28, padding: 0, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent' }} />
          </Field>
          <Field label={`opacity · ${(opacity * 100).toFixed(0)}%`}>
            <input type="range" min={0} max={1} step={0.02} value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))} style={fullW} />
          </Field>
          <Field label={`beats spanned — ${beatsSpanned}`}>
            <div style={btnRow}>
              {([0, 1, 2, 4, 8, 'measure'] as BeatsSpanned[]).map((n) => (
                <button key={String(n)} onClick={() => setBeatsSpanned(n)} style={btn(beatsSpanned === n)}>{String(n)}</button>
              ))}
            </div>
          </Field>
          <Field label={`snappiness — ${snappiness}`}>
            <div style={btnRow}>
              {(['smooth', 'snappy', 'measure'] as Snappiness[]).map((s) => (
                <button key={s} onClick={() => setSnappiness(s)} style={btn(snappiness === s)}>{s}</button>
              ))}
            </div>
          </Field>
          <Field label={`playhead in box — ${bboxAnchor}`}>
            <div style={btnRow}>
              {(['start', 'center'] as BboxAnchor[]).map((a) => (
                <button key={a} onClick={() => setBboxAnchor(a)} style={btn(bboxAnchor === a)}>{a}</button>
              ))}
            </div>
          </Field>
        </Sec>

        <Sec title="Debug">
          <Field label="overlays">
            <button onClick={() => setShowDebug((v: boolean) => !v)} style={btn(showDebug)}>
              {showDebug ? 'hide' : 'show'} measure lines
            </button>
          </Field>
        </Sec>
      </div>

      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => { seek(0); setWindowAnchor(0); setTrainAnchor(0); setHybridAnchor(0); }} style={btn(false)}>Reset</button>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)}</span>
      </Toolbar>

      <div style={{ position: 'relative' }}>
        <InfiniteScrollRenderer
          key={`${equalBeatWidth ? 'eq' : 'nat'}-${zoom.toFixed(2)}`}
          url={scoreUrl}
          height={totalHeight}
          zoom={zoom}
          equalBeatWidth={equalBeatWidth}
          onReady={handleReady}
          onTimeline={handleTimeline}
          onMeasureXs={handleMeasureXs}
          overlay={debugOverlay}
        />
        {/* Playhead line — always visible (including when bbox width is 0),
            colored with the bbox color so it's easy to see. Position: the
            bbox's anchor point — left edge for 'start', center for 'center'. */}
        {bboxLeftPx != null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 30,
            left: bboxLeftPx + (bboxAnchor === 'center' ? bboxWidthPx / 2 : 0) - 1,
            width: 2, background: color, opacity: 0.9,
            boxShadow: `0 0 6px ${hexToRgba(color, 0.6)}`,
            pointerEvents: 'none', zIndex: 5,
          }} />
        )}
        {/* trainTrack grayed prev-bar tail at the left */}
        {trackingMode === 'trainTrack' && trainGrayPx > 0 && (
          <div style={{
            position: 'absolute', top: 0, bottom: 30,
            left: 0, width: trainGrayPx,
            background: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none', zIndex: 4,
            borderRight: '1px dashed rgba(107,159,214,0.5)',
          }} />
        )}
        {/* trainTrack grayed next-page region at the right — everything past
            the N-bar window. The dashed boundary is the page-snap point. */}
        {trackingMode === 'trainTrack' && trainGrayRightStartPx != null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 30,
            left: Math.max(0, trainGrayRightStartPx),
            right: 0,
            background: 'rgba(255,255,255,0.5)',
            pointerEvents: 'none', zIndex: 4,
            borderLeft: '1px dashed rgba(107,159,214,0.5)',
          }} />
        )}
        {/* Bbox overlay */}
        {bboxLeftPx != null && (
          <Bbox leftPx={bboxLeftPx} widthPx={bboxWidthPx} heightMode={heightMode}
            color={color} opacity={opacity} totalHeight={totalHeight} anchor={bboxAnchor} />
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
      <audio ref={audioRef} preload="metadata" src={stemUrl} style={{ display: 'none' }} />

      {timeline.length > 0 && (
        <div style={statsBarStyle}>
          <span>{timeline.length} onsets · {nudgedMeasureXs.length - 1} measures</span>
          <span>px/beat: {stats.minPxPerBeat.toFixed(0)}–{stats.maxPxPerBeat.toFixed(0)} (σ {stats.stddev.toFixed(0)})</span>
          <span>granularity · <strong>{granularity}</strong> · mode · <strong>{trackingMode}</strong></span>
        </div>
      )}
    </div>
  );
}

function Bbox({
  leftPx, widthPx, heightMode, color, opacity, totalHeight, anchor,
}: {
  leftPx: number; widthPx: number; heightMode: HeightMode;
  color: string; opacity: number; totalHeight: number;
  anchor: BboxAnchor;
}) {
  const bottomPad = 30;
  let top: number, height: number;
  if (heightMode === 'capo') { top = 0; height = 6; }
  else if (heightMode === 'staff') { top = (totalHeight - bottomPad) * 0.25; height = (totalHeight - bottomPad) * 0.45; }
  else { top = 4; height = totalHeight - bottomPad - 4; }
  return (
    <div style={{
      position: 'absolute', left: leftPx, top, width: widthPx, height,
      background: hexToRgba(color, opacity),
      ...(anchor === 'start' && widthPx > 0 ? { borderLeft: `2px solid ${color}` } : null),
      borderRadius: 2, pointerEvents: 'none', zIndex: 6,
      transition: 'left 60ms linear, width 80ms linear',
    }} />
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.7rem',
      background: 'var(--bg-elevated)',
    }}>
      <div style={{ fontSize: '0.7em', color: 'var(--accent, #6B9FD6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: '0.78em' }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      {children}
    </label>
  );
}

const controlsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.6rem',
  marginBottom: '0.8rem',
};

const statsBarStyle: React.CSSProperties = {
  display: 'flex', gap: '1.4rem', flexWrap: 'wrap',
  fontSize: '0.72em', color: 'var(--text-secondary)',
  marginTop: 8, padding: '0.4rem 0.6rem',
  background: 'var(--bg-elevated)', borderRadius: 4,
  fontVariantNumeric: 'tabular-nums',
};

const fullW: React.CSSProperties = { width: '100%' };
const btnRow: React.CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '0.25rem 0.4rem',
  background: 'var(--bg-elevated)', color: '#fff',
  border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.85em',
};
const debugLabelStyle: React.CSSProperties = {
  position: 'absolute', top: -13, left: 2,
  fontSize: '9px', lineHeight: 1,
  color: 'rgb(236,72,153)',
  background: 'rgba(0,0,0,0.55)', padding: '1px 3px', borderRadius: 2,
  whiteSpace: 'nowrap',
};

function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function estimateLocalPxPerMeasure(measureXs: number[], measureIdx: number): number {
  const m = Math.floor(measureIdx);
  const a = measureXs[m];
  const b = measureXs[m + 1] ?? measureXs[m - 1];
  if (a == null || b == null) return 200;
  return Math.abs(b - a) || 200;
}

// Default audio supplied by the page is used as the fallback stem. The other
// two stems are derived by substituting their file name — Wiggle-specific but
// fine since this widget is scoped to the Wiggle sample anyway.
function buildStemOptions(fallbackUrl: string): StemOption[] {
  const base = '/wiggle-sample/sooza-brass-band_songs_wiggle-sooza_';
  return [
    { label: 'Trumpet 1', url: `${base}Trumpet%201.mp3` },
    { label: 'SOOZA mix', url: `${base}Sooza.mp3` },
    { label: 'DRM', url: `${base}DRM.mp3` },
    { label: 'page default', url: fallbackUrl },
  ];
}

function usePersisted<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const s = window.localStorage.getItem(key);
      if (s == null) return initial;
      return JSON.parse(s) as T;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota */ }
  }, [key, v]);
  return [v, setV];
}
