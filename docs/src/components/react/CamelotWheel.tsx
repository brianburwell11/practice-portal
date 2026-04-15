import { useState, useRef, useCallback } from 'react';

/* ── Camelot data ── */

const HUES: Record<number, number> = {
  1: 50, 2: 80, 3: 120, 4: 155, 5: 180, 6: 200,
  7: 225, 8: 260, 9: 295, 10: 330, 11: 0, 12: 25,
};

const KEYS: Record<number, {
  major: { short: string; full: string; semi: number };
  minor: { short: string; full: string; semi: number };
}> = {
  1:  { major: { short: 'B',  full: 'B Major',  semi: 11 }, minor: { short: 'A♭m',  full: 'A♭ minor',  semi: 8 } },
  2:  { major: { short: 'F♯', full: 'F♯ Major', semi: 6 },  minor: { short: 'E♭m',  full: 'E♭ minor',  semi: 3 } },
  3:  { major: { short: 'D♭', full: 'D♭ Major', semi: 1 },  minor: { short: 'B♭m',  full: 'B♭ minor',  semi: 10 } },
  4:  { major: { short: 'A♭', full: 'A♭ Major', semi: 8 },  minor: { short: 'Fm',   full: 'F minor',   semi: 5 } },
  5:  { major: { short: 'E♭', full: 'E♭ Major', semi: 3 },  minor: { short: 'Cm',   full: 'C minor',   semi: 0 } },
  6:  { major: { short: 'B♭', full: 'B♭ Major', semi: 10 }, minor: { short: 'Gm',   full: 'G minor',   semi: 7 } },
  7:  { major: { short: 'F',  full: 'F Major',  semi: 5 },  minor: { short: 'Dm',   full: 'D minor',   semi: 2 } },
  8:  { major: { short: 'C',  full: 'C Major',  semi: 0 },  minor: { short: 'Am',   full: 'A minor',   semi: 9 } },
  9:  { major: { short: 'G',  full: 'G Major',  semi: 7 },  minor: { short: 'Em',   full: 'E minor',   semi: 4 } },
  10: { major: { short: 'D',  full: 'D Major',  semi: 2 },  minor: { short: 'Bm',   full: 'B minor',   semi: 11 } },
  11: { major: { short: 'A',  full: 'A Major',  semi: 9 },  minor: { short: 'F♯m',  full: 'F♯ minor',  semi: 6 } },
  12: { major: { short: 'E',  full: 'E Major',  semi: 4 },  minor: { short: 'C♯m',  full: 'C♯ minor',  semi: 1 } },
};

/* ── SVG geometry ── */

const CX = 250, CY = 250;
const R_OUTER = 225, R_MID = 155, R_INNER = 75;

function pt(r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

function arcPath(innerR: number, outerR: number, startDeg: number, endDeg: number): string {
  const os = pt(outerR, startDeg);
  const oe = pt(outerR, endDeg);
  const is_ = pt(innerR, startDeg);
  const ie = pt(innerR, endDeg);
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 0 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 0 0 ${is_.x} ${is_.y}`,
    'Z',
  ].join(' ');
}

/* ── Audio ── */

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ── Segment data ── */

interface Segment {
  id: string;
  keyShort: string;
  keyFull: string;
  hue: number;
  rootMidi: number;
  isMinor: boolean;
  path: string;
  codePos: { x: number; y: number };
  namePos: { x: number; y: number };
}

function buildSegments(): Segment[] {
  const segs: Segment[] = [];
  for (let n = 1; n <= 12; n++) {
    const i = n % 12;
    const startDeg = (i - 0.5) * 30;
    const endDeg = (i + 0.5) * 30;
    const centerDeg = i * 30;
    const hue = HUES[n];
    const k = KEYS[n];

    // Outer ring (B = major)
    const outerMidR = (R_OUTER + R_MID) / 2;
    segs.push({
      id: `${n}B`,
      keyShort: k.major.short,
      keyFull: k.major.full,
      hue,
      rootMidi: 48 + k.major.semi,
      isMinor: false,
      path: arcPath(R_MID, R_OUTER, startDeg, endDeg),
      codePos: pt(outerMidR + 13, centerDeg),
      namePos: pt(outerMidR - 11, centerDeg),
    });

    // Inner ring (A = minor)
    const innerMidR = (R_MID + R_INNER) / 2;
    segs.push({
      id: `${n}A`,
      keyShort: k.minor.short,
      keyFull: k.minor.full,
      hue,
      rootMidi: 48 + k.minor.semi,
      isMinor: true,
      path: arcPath(R_INNER, R_MID, startDeg, endDeg),
      codePos: pt(innerMidR + 11, centerDeg),
      namePos: pt(innerMidR - 11, centerDeg),
    });
  }
  return segs;
}

const SEGMENTS = buildSegments();

/* ── Component ── */

export function CamelotWheel() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playChord = useCallback((seg: Segment) => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const intervals = seg.isMinor ? [0, 3, 7] : [0, 4, 7];

    intervals.forEach((interval) => {
      const freq = midiToFreq(seg.rootMidi + interval);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 2);
    });

    setActive(seg.id);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setActive(null), 1800);
  }, []);

  const activeInfo = active ? SEGMENTS.find((s) => s.id === active) : null;

  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <svg
        viewBox="0 0 500 500"
        style={{ maxWidth: 440, width: '100%' }}
      >
        {SEGMENTS.map((seg) => {
          const isHovered = hovered === seg.id;
          const isActive = active === seg.id;
          const lightness = isActive ? 40 : isHovered ? 35 : 28;
          const fill = `hsl(${seg.hue} 55% ${lightness}%)`;
          const stroke = `hsl(${seg.hue} 40% 15%)`;
          const textFill = `hsl(${seg.hue} 60% ${isActive ? 95 : 82}%)`;
          const isOuter = seg.id.endsWith('B');

          return (
            <g
              key={seg.id}
              onClick={() => playChord(seg)}
              onMouseEnter={() => setHovered(seg.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              <path d={seg.path} fill={fill} stroke={stroke} strokeWidth={1.5} />
              <text
                x={seg.codePos.x}
                y={seg.codePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 13 : 11}
                fontWeight={700}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {seg.id}
              </text>
              <text
                x={seg.namePos.x}
                y={seg.namePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 11 : 9}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {seg.keyShort}
              </text>
            </g>
          );
        })}
        {/* Center circle */}
        <circle cx={CX} cy={CY} r={R_INNER} fill="#111" stroke="#222" strokeWidth={1.5} />
        <text
          x={CX}
          y={CY - 8}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#666"
          fontSize={14}
          fontWeight={600}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          Camelot
        </text>
        <text
          x={CX}
          y={CY + 10}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#555"
          fontSize={11}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          Wheel
        </text>
      </svg>
      <div style={{ height: 28, marginTop: 8, fontSize: 14, color: '#888' }}>
        {activeInfo && (
          <span>
            Playing:{' '}
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: 4,
                background: `hsl(${activeInfo.hue} 50% 25%)`,
                color: `hsl(${activeInfo.hue} 70% 80%)`,
                fontSize: '0.9em',
              }}
            >
              {activeInfo.id}
            </span>{' '}
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: 4,
                background: `hsl(${activeInfo.hue} 50% 25%)`,
                color: `hsl(${activeInfo.hue} 70% 80%)`,
                fontSize: '0.9em',
              }}
            >
              {activeInfo.keyFull}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
