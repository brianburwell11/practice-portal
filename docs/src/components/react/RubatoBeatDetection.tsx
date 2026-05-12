import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Three views of the same rubato passage:
 *  (a) Constant-BPM grid: uniform spacing, true beats drift off-grid.
 *  (b) Local tempo curve: a wavy tempo line, beats sit on the curve
 *      but wobble near tempo-change boundaries.
 *  (c) Onset-following on drum stem: beats land exactly on onsets,
 *      no tempo concept at all.
 *
 * Synthetic data — designed to make the failure mode of a single-BPM
 * grid visible without dressing up the wins of the other two modes.
 */

const W = 720;
const H = 150;
const PAD = 12;
const N = 480;

const ACCENT = '#7B68EE';
const ACCENT_WARM = '#D4A843';
const RED = '#E06C75';
const GREEN = '#7BC894';
const TEXT = '#E0DED8';
const TEXT_DIM = '#808080';
const BG = '#141416';
const BORDER = '#2A2A2C';

type Mode = 'grid' | 'curve' | 'onset';

const MODES: { id: Mode; label: string; subtitle: string }[] = [
  { id: 'grid', label: '(a) Constant-BPM grid', subtitle: 'rekordbox-style: one BPM, evenly spaced' },
  { id: 'curve', label: '(b) Local tempo curve', subtitle: 'windowed tempo — wobbles near transitions' },
  { id: 'onset', label: '(c) Onset-following', subtitle: 'drum stem only, no tempo at all' },
];

/**
 * True beat positions in a rubato phrase: starts slow (ritardando intro),
 * accelerates through the middle, eases back out at the end. Hand-built
 * to make the drift in mode (a) obvious.
 */
const TRUE_BEATS = [0.05, 0.13, 0.22, 0.31, 0.39, 0.46, 0.52, 0.58, 0.65, 0.73, 0.83, 0.94];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Drum-stem-style envelope: near-silent except for sharp spikes on each true beat. */
function makeOnsetEnvelope(): number[] {
  const env = new Array(N).fill(0);
  const r = rng(11);
  for (let i = 0; i < N; i++) env[i] = (r() - 0.5) * 0.02;
  for (const t of TRUE_BEATS) {
    const center = Math.floor(t * N);
    for (let k = -2; k < 14; k++) {
      const idx = center + k;
      if (idx < 0 || idx >= N) continue;
      const x = Math.max(0, k);
      env[idx] += Math.exp(-x * 0.35) * 0.95;
    }
  }
  const max = Math.max(...env);
  return env.map((v) => Math.max(0, v / (max || 1)));
}

/** Onset peaks recovered from the envelope (mode c). */
function pickOnsets(env: number[]): number[] {
  const peaks: number[] = [];
  for (let i = 2; i < env.length - 2; i++) {
    if (
      env[i] > 0.4 &&
      env[i] >= env[i - 1] &&
      env[i] >= env[i + 1] &&
      env[i] > env[i - 2] &&
      env[i] > env[i + 2]
    ) {
      peaks.push(i);
    }
  }
  return peaks;
}

/** Mode (a): take the average inter-onset period and lay down a uniform grid. */
function constantBpmGrid(truePeaks: number[]): number[] {
  if (truePeaks.length < 2) return truePeaks.slice();
  const first = truePeaks[0];
  const last = truePeaks[truePeaks.length - 1];
  const period = (last - first) / (truePeaks.length - 1);
  const grid: number[] = [];
  for (let i = 0; i < truePeaks.length; i++) grid.push(Math.round(first + i * period));
  return grid;
}

/** Mode (b): local tempo curve — a sliding-window period estimate, snapped near onsets. */
function localTempoCurveBeats(truePeaks: number[]): { beats: number[]; curveBpm: number[] } {
  const beats: number[] = [];
  const curveBpm = new Array(N).fill(0);
  // Estimate a smoothed period at each sample
  const periodsAt: number[] = new Array(truePeaks.length).fill(0);
  for (let i = 0; i < truePeaks.length; i++) {
    const lo = Math.max(0, i - 2);
    const hi = Math.min(truePeaks.length - 1, i + 2);
    periodsAt[i] = (truePeaks[hi] - truePeaks[lo]) / (hi - lo || 1);
  }
  // Walk forward using local period — but introduce small wobble near
  // tempo-change boundaries (second derivative spikes).
  beats.push(truePeaks[0]);
  for (let i = 1; i < truePeaks.length; i++) {
    const prev = beats[beats.length - 1];
    const localPeriod = periodsAt[i];
    let target = prev + localPeriod;
    // Wobble: where local period is changing fastest, pull toward the wrong place
    const accel = i > 1 ? periodsAt[i] - periodsAt[i - 1] : 0;
    target += accel * 0.45;
    beats.push(Math.round(target));
  }
  // Build the visual tempo curve (BPM units, normalized for plotting)
  for (let i = 0; i < N; i++) {
    // Find the two surrounding true beats and interpolate their local period
    let bi = 0;
    while (bi < truePeaks.length - 1 && truePeaks[bi + 1] < i) bi++;
    const p = periodsAt[Math.min(periodsAt.length - 1, bi)];
    // Convert period (samples) -> BPM-ish (assume N samples = 4 sec)
    const secPerBeat = (p / N) * 4;
    curveBpm[i] = 60 / Math.max(0.001, secPerBeat);
  }
  return { beats, curveBpm };
}

export function RubatoBeatDetection() {
  const [mode, setMode] = useState<Mode>('grid');

  const env = useMemo(() => makeOnsetEnvelope(), []);
  const truePeaks = useMemo(() => TRUE_BEATS.map((t) => Math.round(t * N)), []);
  const onsetPeaks = useMemo(() => pickOnsets(env), [env]);
  const gridBeats = useMemo(() => constantBpmGrid(truePeaks), [truePeaks]);
  const curve = useMemo(() => localTempoCurveBeats(truePeaks), [truePeaks]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const detected =
      mode === 'grid' ? gridBeats : mode === 'curve' ? curve.beats : onsetPeaks;
    drawPanel(canvasRef.current, env, truePeaks, detected, mode, curve.curveBpm);
  }, [mode, env, truePeaks, gridBeats, curve, onsetPeaks]);

  const drift = useMemo(() => {
    const detected =
      mode === 'grid' ? gridBeats : mode === 'curve' ? curve.beats : onsetPeaks;
    return avgDriftMs(detected, truePeaks);
  }, [mode, gridBeats, curve, onsetPeaks, truePeaks]);

  const good = drift < 15;

  return (
    <div
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: '1rem',
        margin: '1.5rem 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          alignItems: 'center',
        }}
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 6,
              border: `1px solid ${m.id === mode ? ACCENT : BORDER}`,
              background: m.id === mode ? 'rgba(123,104,238,0.18)' : 'transparent',
              color: m.id === mode ? TEXT : TEXT_DIM,
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {m.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span
          style={{
            color: good ? GREEN : RED,
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          avg drift {drift.toFixed(1)} ms
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          background: '#0D0D0F',
          borderRadius: 6,
          border: `1px solid ${BORDER}`,
        }}
      />

      <div
        style={{
          marginTop: '0.6rem',
          color: TEXT_DIM,
          fontSize: '0.85rem',
          minHeight: '2.5em',
        }}
      >
        {mode === 'grid' && (
          <span>
            One BPM, evenly spaced. The grid lines its first and last beat up with the music,
            then drifts everywhere in between — the ritardando into the phrase and the push
            through the middle both pull the real beats away from the grid.
          </span>
        )}
        {mode === 'curve' && (
          <span>
            A windowed autocorrelation produces a tempo <em>curve</em> instead of a single
            BPM. Most beats land on real onsets, but the wobble at tempo-change boundaries
            still leaks through — the estimator is always one window behind the music.
          </span>
        )}
        {mode === 'onset' && (
          <span>
            Skip tempo entirely. With a clean drum-stem envelope, every detected onset
            becomes a beat. No grid, no BPM, no assumption that the spacing is regular —
            which is exactly what a rubato passage needs.
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: '0.6rem',
          display: 'flex',
          gap: '1rem',
          fontSize: '0.72rem',
          color: TEXT_DIM,
          flexWrap: 'wrap',
        }}
      >
        <LegendSwatch color={ACCENT} label="onset envelope" />
        <LegendSwatch color={ACCENT_WARM} label="detected beat" />
        <LegendSwatch color="#fff" label="true beat" dashed />
        {mode === 'curve' && <LegendSwatch color={GREEN} label="tempo curve" />}
      </div>
    </div>
  );
}

function LegendSwatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-block',
          width: 16,
          height: 0,
          borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
        }}
      />
      {label}
    </span>
  );
}

function drawPanel(
  canvas: HTMLCanvasElement | null,
  env: number[],
  trueBeats: number[],
  detected: number[],
  mode: Mode,
  curveBpm: number[],
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  // Tempo curve as a filled band in the upper third (only in curve mode)
  if (mode === 'curve') {
    const top = PAD;
    const bandH = 32;
    const minBpm = Math.min(...curveBpm.filter((v) => v > 0));
    const maxBpm = Math.max(...curveBpm);
    const span = Math.max(1, maxBpm - minBpm);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < curveBpm.length; i++) {
      const x = PAD + (i / (curveBpm.length - 1)) * (W - PAD * 2);
      const v = (curveBpm[i] - minBpm) / span;
      const y = top + bandH - v * bandH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '10px sans-serif';
    ctx.fillText(`tempo curve  ${Math.round(minBpm)}–${Math.round(maxBpm)} BPM`, PAD + 2, top + 10);
  }

  // Onset envelope (filled, like the other widgets)
  const envTop = mode === 'curve' ? PAD + 40 : PAD;
  const envH = H - envTop - PAD;
  const grd = ctx.createLinearGradient(0, envTop, 0, H - PAD);
  grd.addColorStop(0, 'rgba(123,104,238,0.5)');
  grd.addColorStop(1, 'rgba(123,104,238,0.05)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(PAD, H - PAD);
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * envH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W - PAD, H - PAD);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * envH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Ground truth (dashed white)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  for (const b of trueBeats) {
    const x = PAD + (b / (env.length - 1)) * (W - PAD * 2);
    ctx.beginPath();
    ctx.moveTo(x, envTop);
    ctx.lineTo(x, H - PAD);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Detected beats (warm)
  detected.forEach((b) => {
    const x = PAD + (b / (env.length - 1)) * (W - PAD * 2);
    ctx.strokeStyle = ACCENT_WARM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, envTop);
    ctx.lineTo(x, H - PAD);
    ctx.stroke();
    ctx.fillStyle = ACCENT_WARM;
    ctx.beginPath();
    ctx.arc(x, envTop + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Mode label, bottom-left
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '10px sans-serif';
  ctx.fillText(
    mode === 'grid'
      ? 'uniform spacing — drifts'
      : mode === 'curve'
        ? 'follows the curve — small wobble'
        : 'follows the onsets — exact',
    PAD + 2,
    H - 2,
  );
}

function avgDriftMs(detected: number[], truth: number[]): number {
  // N samples = ~4 seconds of synthetic audio, so ~8.33 ms per sample.
  const msPerSample = 4000 / N;
  let total = 0;
  let count = 0;
  for (let i = 0; i < Math.min(detected.length, truth.length); i++) {
    total += Math.abs(detected[i] - truth[i]) * msPerSample;
    count++;
  }
  return count ? total / count : 0;
}
