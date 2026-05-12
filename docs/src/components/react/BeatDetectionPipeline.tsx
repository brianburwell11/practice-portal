import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Drop-in beat-tracking pipeline demo.
 *
 * Stylized walk-through of the rekordbox-style pipeline:
 *  1. raw waveform
 *  2. onset envelope (half-wave rectified spectral flux)
 *  3. autocorrelation -> tempo estimate
 *  4. dynamic-programming beat grid locked to onsets
 *
 * Uses synthetic data, not real DSP — the point is to *show* the
 * shape of each stage in a way that matches what real onset/tempo
 * estimators produce.
 */

const W = 720;
const H = 120;
const PAD = 12;
const N = 480; // samples in our synthetic signal
const FPS = 60;

const ACCENT = '#7B68EE';
const ACCENT_WARM = '#D4A843';
const TEXT = '#E0DED8';
const TEXT_DIM = '#808080';
const BG = '#141416';
const BORDER = '#2A2A2C';

const STAGES = [
  { id: 'wave', label: '1. Raw waveform' },
  { id: 'onset', label: '2. Onset envelope' },
  { id: 'acf', label: '3. Autocorrelation → tempo' },
  { id: 'grid', label: '4. Beat grid locked to onsets' },
] as const;
type StageId = (typeof STAGES)[number]['id'];

/** Synthetic mixed-track waveform: kick-and-snare every "beat" + harmony noise. */
function makeWaveform(): number[] {
  const out: number[] = new Array(N).fill(0);
  // 8 beats across the buffer (so beat spacing ~60 samples)
  const beatSpacing = 60;
  // Pseudo-random but deterministic
  let seed = 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < N; i++) {
    // Sustained harmonic content
    out[i] += 0.10 * Math.sin(i * 0.18) + 0.07 * Math.sin(i * 0.31 + 1.3);
    // Hiss
    out[i] += (rand() - 0.5) * 0.08;
  }
  // Add transients on each beat
  for (let b = 0; b < 8; b++) {
    const center = 18 + b * beatSpacing;
    // Kick: low decay
    for (let k = 0; k < 18; k++) {
      const env = Math.exp(-k * 0.25);
      const v = env * Math.sin(k * 0.6) * 0.9;
      if (center + k < N) out[center + k] += v;
    }
    // Snare on every other beat
    if (b % 2 === 1) {
      for (let k = 0; k < 14; k++) {
        const env = Math.exp(-k * 0.35);
        if (center + k < N) out[center + k] += (rand() - 0.5) * env * 0.7;
      }
    }
  }
  // Normalize-ish
  const max = Math.max(...out.map((v) => Math.abs(v)));
  return out.map((v) => v / (max || 1));
}

/** Half-wave rectified energy difference (a stand-in for spectral flux). */
function makeOnsetEnvelope(wave: number[]): number[] {
  const winLen = 6;
  const env: number[] = new Array(wave.length).fill(0);
  let prev = 0;
  for (let i = winLen; i < wave.length; i++) {
    let energy = 0;
    for (let k = 0; k < winLen; k++) energy += wave[i - k] * wave[i - k];
    energy = Math.sqrt(energy / winLen);
    const flux = Math.max(0, energy - prev);
    env[i] = flux;
    prev = energy * 0.7 + prev * 0.3;
  }
  // Smooth slightly
  const sm: number[] = new Array(env.length).fill(0);
  for (let i = 0; i < env.length; i++) {
    const a = env[Math.max(0, i - 1)];
    const b = env[i];
    const c = env[Math.min(env.length - 1, i + 1)];
    sm[i] = (a + b + c) / 3;
  }
  const max = Math.max(...sm);
  return sm.map((v) => v / (max || 1));
}

/** Cheap normalized autocorrelation of the onset envelope. */
function autocorrelate(env: number[], minLag: number, maxLag: number): number[] {
  const out: number[] = new Array(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    out[lag] = s;
  }
  const max = Math.max(...out);
  return out.map((v) => v / (max || 1));
}

function argmax(arr: number[]): number {
  let best = 0;
  let bestI = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > best) {
      best = arr[i];
      bestI = i;
    }
  }
  return bestI;
}

/** Pick beats by walking the onset envelope at the chosen period, snapping to nearest local peak. */
function pickBeats(env: number[], period: number): number[] {
  const beats: number[] = [];
  // Find first strong onset as anchor
  let anchor = 0;
  let best = 0;
  for (let i = 0; i < env.length / 2; i++) {
    if (env[i] > best) {
      best = env[i];
      anchor = i;
    }
  }
  let pos = anchor;
  while (pos < env.length) {
    // Snap to nearest local max within +/- period/6
    const wnd = Math.max(2, Math.floor(period / 6));
    let bestIdx = pos;
    let bestVal = env[Math.min(env.length - 1, Math.max(0, pos))];
    for (let k = -wnd; k <= wnd; k++) {
      const idx = pos + k;
      if (idx >= 0 && idx < env.length && env[idx] > bestVal) {
        bestVal = env[idx];
        bestIdx = idx;
      }
    }
    beats.push(bestIdx);
    pos = bestIdx + period;
  }
  return beats;
}

export function BeatDetectionPipeline() {
  const [stage, setStage] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef<number>(0);

  const wave = useMemo(() => makeWaveform(), []);
  const onset = useMemo(() => makeOnsetEnvelope(wave), [wave]);
  // Lag range in samples (corresponds to ~75-180 BPM at our synthetic rate)
  const minLag = 35;
  const maxLag = 110;
  const acf = useMemo(() => autocorrelate(onset, minLag, maxLag), [onset]);
  const periodSamples = useMemo(() => argmax(acf), [acf]);
  const beats = useMemo(() => pickBeats(onset, periodSamples || 60), [onset, periodSamples]);

  // Approximate "BPM" given our synthetic frame rate. We declare 60 samples = 1 beat
  // so the headline number stays human-friendly (~120 BPM-ish).
  const bpm = Math.round((60 / Math.max(1, periodSamples)) * 120);

  // Animation: a moving playhead in the final stage to make the locked grid feel alive.
  useEffect(() => {
    if (stage !== 3 || !playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const start = performance.now();
    const total = 4500;
    const loop = (now: number) => {
      tRef.current = ((now - start) % total) / total;
      drawAll(canvasRef.current, stage, wave, onset, acf, minLag, maxLag, beats, tRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [stage, playing, wave, onset, acf, beats]);

  // Static draw whenever stage changes or we're paused
  useEffect(() => {
    if (playing && stage === 3) return;
    drawAll(canvasRef.current, stage, wave, onset, acf, minLag, maxLag, beats, 0);
  }, [stage, playing, wave, onset, acf, beats]);

  // Autoplay between stages on first interaction with the Next button
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
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStage(i)}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 6,
              border: `1px solid ${i === stage ? ACCENT : BORDER}`,
              background: i === stage ? 'rgba(123,104,238,0.18)' : 'transparent',
              color: i === stage ? TEXT : TEXT_DIM,
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            if (stage < STAGES.length - 1) setStage(stage + 1);
            else {
              setStage(0);
              setPlaying(false);
            }
          }}
          style={{
            padding: '0.35rem 0.9rem',
            borderRadius: 6,
            border: `1px solid ${ACCENT}`,
            background: ACCENT,
            color: '#0D0D0F',
            fontSize: '0.8rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
          }}
        >
          {stage < STAGES.length - 1 ? 'Next →' : 'Restart'}
        </button>
        {stage === 3 && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: 6,
              border: `1px solid ${BORDER}`,
              background: 'transparent',
              color: TEXT,
              fontSize: '0.8rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {playing ? 'Pause' : 'Play grid'}
          </button>
        )}
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
        {stage === 0 && (
          <span>
            A short slice of a mixed track. Kicks, snares, hiss and harmony are all jumbled
            together — the time-domain waveform alone doesn't tell us where the beats are.
          </span>
        )}
        {stage === 1 && (
          <span>
            We take a moving energy difference (a stand-in for spectral flux). Sudden increases
            in energy spike upward — these are <em>onsets</em>. The harmony falls away; the
            transients pop out.
          </span>
        )}
        {stage === 2 && (
          <span>
            We autocorrelate the onset envelope and pick the strongest lag in the plausible
            tempo range. The peak gives the beat period — here roughly{' '}
            <strong style={{ color: ACCENT_WARM }}>{bpm} BPM</strong>.
          </span>
        )}
        {stage === 3 && (
          <span>
            We anchor a grid at the first strong onset and step forward by the estimated period,
            snapping each beat to the nearest local peak. That's the beatgrid rekordbox writes
            into the file.
          </span>
        )}
      </div>
    </div>
  );
}

function drawAll(
  canvas: HTMLCanvasElement | null,
  stage: number,
  wave: number[],
  onset: number[],
  acf: number[],
  minLag: number,
  maxLag: number,
  beats: number[],
  playT: number,
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  if (stage === 0) drawWave(ctx, wave);
  else if (stage === 1) drawOnset(ctx, onset);
  else if (stage === 2) drawACF(ctx, acf, minLag, maxLag);
  else drawGrid(ctx, onset, beats, playT);
}

function drawWave(ctx: CanvasRenderingContext2D, wave: number[]) {
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = PAD + (i / (wave.length - 1)) * (W - PAD * 2);
    const y = H / 2 + wave[i] * (H / 2 - PAD);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Mid-line
  ctx.strokeStyle = 'rgba(123,104,238,0.18)';
  ctx.beginPath();
  ctx.moveTo(PAD, H / 2);
  ctx.lineTo(W - PAD, H / 2);
  ctx.stroke();
}

function drawOnset(ctx: CanvasRenderingContext2D, env: number[]) {
  // Filled envelope
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(123,104,238,0.55)');
  grd.addColorStop(1, 'rgba(123,104,238,0.05)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(PAD, H - PAD);
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * (H - PAD * 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W - PAD, H - PAD);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * (H - PAD * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Mark prominent peaks
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > 0.45 && env[i] > env[i - 1] && env[i] > env[i + 1]) {
      const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
      const y = H - PAD - env[i] * (H - PAD * 2);
      ctx.fillStyle = ACCENT_WARM;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawACF(ctx: CanvasRenderingContext2D, acf: number[], minLag: number, maxLag: number) {
  // Plot lags minLag..maxLag across the width
  const span = maxLag - minLag;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i <= span; i++) {
    const v = acf[minLag + i] ?? 0;
    const x = PAD + (i / span) * (W - PAD * 2);
    const y = H - PAD - Math.max(0, v) * (H - PAD * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Mark the peak
  let bestI = 0;
  let bestV = 0;
  for (let i = 0; i <= span; i++) {
    if ((acf[minLag + i] ?? 0) > bestV) {
      bestV = acf[minLag + i];
      bestI = i;
    }
  }
  const x = PAD + (bestI / span) * (W - PAD * 2);
  ctx.strokeStyle = ACCENT_WARM;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, PAD);
  ctx.lineTo(x, H - PAD);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ACCENT_WARM;
  ctx.beginPath();
  ctx.arc(x, H - PAD - bestV * (H - PAD * 2), 4, 0, Math.PI * 2);
  ctx.fill();

  // Axis labels
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '11px sans-serif';
  ctx.fillText('short lag (fast)', PAD + 2, H - 2);
  const label = 'long lag (slow)';
  const m = ctx.measureText(label);
  ctx.fillText(label, W - PAD - m.width, H - 2);
  ctx.fillStyle = ACCENT_WARM;
  ctx.fillText('peak → beat period', x + 6, PAD + 10);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  env: number[],
  beats: number[],
  playT: number,
) {
  // Faint envelope behind
  ctx.fillStyle = 'rgba(123,104,238,0.18)';
  ctx.beginPath();
  ctx.moveTo(PAD, H - PAD);
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * (H - PAD * 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W - PAD, H - PAD);
  ctx.closePath();
  ctx.fill();

  // Beat lines
  beats.forEach((b, i) => {
    const x = PAD + (b / (env.length - 1)) * (W - PAD * 2);
    const isDown = i % 4 === 0;
    ctx.strokeStyle = isDown ? ACCENT_WARM : ACCENT;
    ctx.lineWidth = isDown ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, PAD);
    ctx.lineTo(x, H - PAD);
    ctx.stroke();
  });

  // Playhead
  if (playT > 0) {
    const x = PAD + playT * (W - PAD * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Legend
  ctx.fillStyle = ACCENT_WARM;
  ctx.font = '11px sans-serif';
  ctx.fillText('downbeat', PAD + 2, 14);
  ctx.fillStyle = ACCENT;
  ctx.fillText('beat', PAD + 70, 14);
}
