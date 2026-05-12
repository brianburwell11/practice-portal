import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Side-by-side comparison of beat detection on a full mix vs an
 * isolated drums stem. Synthetic data, designed to make the failure
 * mode of full-mix detection visible:
 *
 *  - Full mix onset envelope has lots of "false" peaks from sustained
 *    harmony / vocal entrances, so the grid drifts and misaligns.
 *  - Drum stem has clean, sparse peaks aligned to the real beats.
 */

const W = 360;
const H = 130;
const PAD = 10;
const N = 360;

const ACCENT = '#7B68EE';
const ACCENT_WARM = '#D4A843';
const RED = '#E06C75';
const GREEN = '#7BC894';
const TEXT = '#E0DED8';
const TEXT_DIM = '#808080';
const BORDER = '#2A2A2C';

interface Pulse {
  pos: number; // 0..1 along the buffer
  amp: number;
  decay: number; // higher = shorter
  noise?: boolean; // random-broadband (snare-like)
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function synthesize(pulses: Pulse[], harmony: boolean, seed: number): number[] {
  const out = new Array(N).fill(0);
  const r = rng(seed);
  // Background
  for (let i = 0; i < N; i++) {
    if (harmony) {
      // Slow swells + tonal content (mimics pads, vocals, bass sustain)
      out[i] += 0.18 * Math.sin(i * 0.07);
      out[i] += 0.10 * Math.sin(i * 0.21 + 0.6);
      out[i] += 0.06 * Math.sin(i * 0.41 + 1.2);
      // A long vocal-like swell that peaks off-beat
      const swell = Math.max(0, Math.sin((i - 70) * 0.025));
      out[i] += swell * 0.22 * Math.sin(i * 0.13);
      out[i] += (r() - 0.5) * 0.04;
    } else {
      // Drum stem: near silence between hits
      out[i] += (r() - 0.5) * 0.015;
    }
  }
  for (const p of pulses) {
    const center = Math.floor(p.pos * N);
    const len = Math.ceil(8 / p.decay);
    for (let k = 0; k < len; k++) {
      const env = p.amp * Math.exp(-k * p.decay);
      const idx = center + k;
      if (idx >= 0 && idx < N) {
        if (p.noise) out[idx] += env * (r() - 0.5) * 1.4;
        else out[idx] += env * Math.sin(k * 0.55);
      }
    }
  }
  const max = Math.max(...out.map((v) => Math.abs(v)));
  return out.map((v) => v / (max || 1));
}

function onsetEnvelope(wave: number[]): number[] {
  const winLen = 5;
  const env = new Array(wave.length).fill(0);
  let prev = 0;
  for (let i = winLen; i < wave.length; i++) {
    let e = 0;
    for (let k = 0; k < winLen; k++) e += wave[i - k] * wave[i - k];
    e = Math.sqrt(e / winLen);
    env[i] = Math.max(0, e - prev);
    prev = e * 0.7 + prev * 0.3;
  }
  const sm = new Array(env.length).fill(0);
  for (let i = 0; i < env.length; i++) {
    const a = env[Math.max(0, i - 1)];
    const b = env[i];
    const c = env[Math.min(env.length - 1, i + 1)];
    sm[i] = (a + b + c) / 3;
  }
  const max = Math.max(...sm);
  return sm.map((v) => v / (max || 1));
}

/** Pick beats greedily near the expected period. */
function detectBeats(env: number[], period: number): number[] {
  const beats: number[] = [];
  // Start at the largest peak in the first stretch
  let bestI = 0;
  let bestV = 0;
  for (let i = 0; i < env.length / 4; i++) {
    if (env[i] > bestV) {
      bestV = env[i];
      bestI = i;
    }
  }
  let pos = bestI;
  while (pos < env.length) {
    const wnd = Math.max(3, Math.floor(period / 4));
    let snapI = pos;
    let snapV = env[Math.min(env.length - 1, Math.max(0, pos))];
    for (let k = -wnd; k <= wnd; k++) {
      const idx = pos + k;
      if (idx >= 0 && idx < env.length && env[idx] > snapV) {
        snapV = env[idx];
        snapI = idx;
      }
    }
    beats.push(snapI);
    pos = snapI + period;
  }
  return beats;
}

/** True beat positions used to score quality. */
const TRUE_BEATS_POS = [0.06, 0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.90];
const PERIOD = Math.round((TRUE_BEATS_POS[1] - TRUE_BEATS_POS[0]) * N);

function makeDrumPulses(): Pulse[] {
  const pulses: Pulse[] = [];
  TRUE_BEATS_POS.forEach((p, i) => {
    // Kick
    pulses.push({ pos: p, amp: 1.0, decay: 0.32 });
    // Snare on backbeats
    if (i % 2 === 1) pulses.push({ pos: p + 0.003, amp: 0.85, decay: 0.4, noise: true });
  });
  return pulses;
}

function makeMixPulses(): Pulse[] {
  // Drums are still in there, plus a few off-beat harmonic entries
  // (chord stab on a syncopated beat, vocal consonant between beats).
  const pulses = makeDrumPulses().map((p) => ({ ...p, amp: p.amp * 0.55 }));
  pulses.push({ pos: 0.24, amp: 0.55, decay: 0.12 }); // chord stab between beats
  pulses.push({ pos: 0.48, amp: 0.6, decay: 0.10 }); // vocal entry
  pulses.push({ pos: 0.72, amp: 0.5, decay: 0.14 });
  return pulses;
}

export function StemsBeatComparison() {
  const mixWave = useMemo(() => synthesize(makeMixPulses(), true, 7), []);
  const drumWave = useMemo(() => synthesize(makeDrumPulses(), false, 13), []);
  const mixEnv = useMemo(() => onsetEnvelope(mixWave), [mixWave]);
  const drumEnv = useMemo(() => onsetEnvelope(drumWave), [drumWave]);

  const mixBeats = useMemo(() => detectBeats(mixEnv, PERIOD), [mixEnv]);
  const drumBeats = useMemo(() => detectBeats(drumEnv, PERIOD), [drumEnv]);

  const trueBeats = useMemo(() => TRUE_BEATS_POS.map((p) => Math.round(p * N)), []);

  const [showTrue, setShowTrue] = useState(true);

  const mixRef = useRef<HTMLCanvasElement | null>(null);
  const drumRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawPanel(mixRef.current, mixEnv, mixBeats, trueBeats, showTrue, 'mix');
    drawPanel(drumRef.current, drumEnv, drumBeats, trueBeats, showTrue, 'drums');
  }, [mixEnv, drumEnv, mixBeats, drumBeats, trueBeats, showTrue]);

  const mixDrift = avgDriftMs(mixBeats, trueBeats);
  const drumDrift = avgDriftMs(drumBeats, trueBeats);

  return (
    <div
      style={{
        margin: '1.5rem 0',
        padding: '1rem',
        background: '#141416',
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <span style={{ color: TEXT_DIM, fontSize: '0.85rem' }}>
          Same eight-beat clip, two different sources fed to the detector.
        </span>
        <label style={{ color: TEXT_DIM, fontSize: '0.8rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showTrue}
            onChange={(e) => setShowTrue(e.target.checked)}
            style={{ marginRight: 6, verticalAlign: 'middle' }}
          />
          Show ground truth
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.75rem',
        }}
      >
        <Panel
          title="Full mix"
          subtitle="harmony + vocals + drums"
          canvasRef={mixRef}
          drift={mixDrift}
          good={false}
        />
        <Panel
          title="Drums stem"
          subtitle="just the kit"
          canvasRef={drumRef}
          drift={drumDrift}
          good={true}
        />
      </div>

      <div
        style={{
          marginTop: '0.75rem',
          display: 'flex',
          gap: '1rem',
          fontSize: '0.75rem',
          color: TEXT_DIM,
          flexWrap: 'wrap',
        }}
      >
        <LegendSwatch color={ACCENT} label="onset envelope" />
        <LegendSwatch color={ACCENT_WARM} label="detected beat" />
        {showTrue && <LegendSwatch color="#fff" label="ground-truth beat" dashed />}
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  canvasRef,
  drift,
  good,
}: {
  title: string;
  subtitle: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drift: number;
  good: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${good ? 'rgba(123,200,148,0.4)' : 'rgba(224,108,117,0.35)'}`,
        borderRadius: 8,
        padding: '0.6rem',
        background: '#0D0D0F',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.4rem',
        }}
      >
        <div>
          <div style={{ color: TEXT, fontSize: '0.9rem', fontWeight: 600 }}>{title}</div>
          <div style={{ color: TEXT_DIM, fontSize: '0.72rem' }}>{subtitle}</div>
        </div>
        <div
          style={{
            color: good ? GREEN : RED,
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          avg drift {drift.toFixed(1)} ms
        </div>
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
          borderRadius: 4,
        }}
      />
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
  beats: number[],
  trueBeats: number[],
  showTrue: boolean,
  kind: 'mix' | 'drums',
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  // Filled envelope
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(123,104,238,0.5)');
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
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < env.length; i++) {
    const x = PAD + (i / (env.length - 1)) * (W - PAD * 2);
    const y = H - PAD - env[i] * (H - PAD * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Ground truth (dashed white)
  if (showTrue) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    for (const b of trueBeats) {
      const x = PAD + (b / (env.length - 1)) * (W - PAD * 2);
      ctx.beginPath();
      ctx.moveTo(x, PAD);
      ctx.lineTo(x, H - PAD);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Detected beats (solid warm)
  beats.forEach((b) => {
    const x = PAD + (b / (env.length - 1)) * (W - PAD * 2);
    ctx.strokeStyle = ACCENT_WARM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, PAD);
    ctx.lineTo(x, H - PAD);
    ctx.stroke();
    // dot at the top
    ctx.fillStyle = ACCENT_WARM;
    ctx.beginPath();
    ctx.arc(x, PAD + 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Quiet label
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '10px sans-serif';
  ctx.fillText(kind === 'mix' ? 'noisy onsets' : 'clean onsets', PAD + 2, H - 2);
}

function avgDriftMs(detected: number[], truth: number[]): number {
  // Pretend N samples = 2 seconds, so each sample ≈ 5.55 ms.
  const msPerSample = 2000 / N;
  let total = 0;
  let count = 0;
  for (let i = 0; i < Math.min(detected.length, truth.length); i++) {
    total += Math.abs(detected[i] - truth[i]) * msPerSample;
    count++;
  }
  return count ? total / count : 0;
}
