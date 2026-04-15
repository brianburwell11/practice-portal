import { useState, useRef, useCallback } from 'react';

/* ── Camelot data (shared with CamelotWheel) ── */

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

let audioCtx: AudioContext | null = null;

function playTriad(rootMidi: number, isMinor: boolean) {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  for (const iv of isMinor ? [0, 3, 7] : [0, 4, 7]) {
    const freq = 440 * Math.pow(2, (rootMidi + iv - 69) / 12);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.13, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 2);
  }
}

/* ── Segment data ── */

interface Segment {
  id: string;
  num: number;
  side: 'A' | 'B';
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

    const outerMidR = (R_OUTER + R_MID) / 2;
    segs.push({
      id: `${n}B`, num: n, side: 'B',
      keyShort: k.major.short, keyFull: k.major.full, hue,
      rootMidi: 48 + k.major.semi, isMinor: false,
      path: arcPath(R_MID, R_OUTER, startDeg, endDeg),
      codePos: pt(outerMidR + 13, centerDeg),
      namePos: pt(outerMidR - 11, centerDeg),
    });

    const innerMidR = (R_MID + R_INNER) / 2;
    segs.push({
      id: `${n}A`, num: n, side: 'A',
      keyShort: k.minor.short, keyFull: k.minor.full, hue,
      rootMidi: 48 + k.minor.semi, isMinor: true,
      path: arcPath(R_INNER, R_MID, startDeg, endDeg),
      codePos: pt(innerMidR + 11, centerDeg),
      namePos: pt(innerMidR - 11, centerDeg),
    });
  }
  return segs;
}

const SEGMENTS = buildSegments();
const SEG_MAP = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]));

/* ── Transition rules ── */

type Rule = 'same' | 'relative' | 'adjacent' | 'boost' | 'drop' | 'parallel';

const wrap = (n: number) => ((((n - 1) % 12) + 12) % 12) + 1;

function getTargets(sourceId: string, rule: Rule): string[] {
  const seg = SEG_MAP[sourceId];
  if (!seg) return [];
  const { num: n, side } = seg;

  switch (rule) {
    case 'same':
      return [sourceId];
    case 'relative':
      return [`${n}${side === 'A' ? 'B' : 'A'}`];
    case 'adjacent':
      return [`${wrap(n + 1)}${side}`, `${wrap(n - 1)}${side}`];
    case 'boost':
      return [`${wrap(n + 7)}${side}`];
    case 'drop':
      return [`${wrap(n + 5)}${side}`];
    case 'parallel':
      return side === 'B' ? [`${wrap(n - 3)}A`] : [`${wrap(n + 3)}B`];
  }
}

const RULE_LABELS: Record<Rule, string> = {
  same: 'Same key',
  relative: 'Relative key',
  adjacent: 'Adjacent (±1)',
  boost: 'Energy boost (+7)',
  drop: 'Energy drop (+5)',
  parallel: 'Parallel key',
};

/* ── Component ── */

interface Props {
  rule: Rule;
}

export function CamelotWheelTransitions({ rule }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targets = hovered ? getTargets(hovered, rule) : [];
  const targetSet = new Set(targets);

  const handleClick = useCallback((seg: Segment) => {
    playTriad(seg.rootMidi, seg.isMinor);
    setActive(seg.id);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setActive(null), 1800);
  }, []);

  const hoveredSeg = hovered ? SEG_MAP[hovered] : null;
  const targetSegs = targets.map((id) => SEG_MAP[id]).filter(Boolean);

  return (
    <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
      <svg viewBox="0 0 500 500" style={{ maxWidth: 380, width: '100%' }}>
        {SEGMENTS.map((seg) => {
          const isSource = hovered === seg.id;
          const isTarget = targetSet.has(seg.id) && !isSource;
          const isActive = active === seg.id;
          const dimmed = hovered && !isSource && !isTarget;
          const isOuter = seg.side === 'B';

          let lightness = 28;
          let saturation = 55;
          let opacity = 1;
          let strokeColor = `hsl(${seg.hue} 40% 15%)`;
          let strokeWidth = 1.5;

          if (isActive) {
            lightness = 45;
          } else if (isSource) {
            lightness = 42;
            saturation = 65;
            strokeColor = '#fff';
            strokeWidth = 2.5;
          } else if (isTarget) {
            lightness = 40;
            saturation = 70;
            strokeColor = `hsl(${seg.hue} 80% 65%)`;
            strokeWidth = 2.5;
          } else if (dimmed) {
            lightness = 15;
            saturation = 25;
            opacity = 0.5;
          }

          const fill = `hsl(${seg.hue} ${saturation}% ${lightness}%)`;
          const textAlpha = dimmed ? 0.35 : 1;
          const textFill = `hsl(${seg.hue} 60% ${isSource || isTarget || isActive ? 95 : 82}%)`;

          return (
            <g
              key={seg.id}
              onClick={() => handleClick(seg)}
              onMouseEnter={() => setHovered(seg.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer', opacity, transition: 'opacity 0.15s' }}
            >
              <path
                d={seg.path}
                fill={fill}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                style={{ transition: 'fill 0.15s, stroke 0.15s' }}
              />
              <text
                x={seg.codePos.x}
                y={seg.codePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 12 : 10}
                fontWeight={700}
                opacity={textAlpha}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'opacity 0.15s' }}
              >
                {seg.id}
              </text>
              <text
                x={seg.namePos.x}
                y={seg.namePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 10 : 8}
                opacity={textAlpha}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'opacity 0.15s' }}
              >
                {seg.keyShort}
              </text>
            </g>
          );
        })}
        {/* Center circle */}
        <circle cx={CX} cy={CY} r={R_INNER} fill="#111" stroke="#222" strokeWidth={1.5} />
        <text
          x={CX} y={CY - 4}
          textAnchor="middle" dominantBaseline="central"
          fill="#666" fontSize={12} fontWeight={600}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {RULE_LABELS[rule]}
        </text>
      </svg>
      <div style={{ minHeight: 24, fontSize: 13, color: '#888', lineHeight: 1.6 }}>
        {hoveredSeg ? (
          <span>
            <span style={{
              display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: '0.9em',
              background: `hsl(${hoveredSeg.hue} 50% 25%)`, color: `hsl(${hoveredSeg.hue} 70% 80%)`,
            }}>{hoveredSeg.id}</span>
            {' '}{hoveredSeg.keyFull}
            {targetSegs.length > 0 && targetSegs[0].id !== hoveredSeg.id && (
              <>
                {' → '}
                {targetSegs.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && ', '}
                    <span style={{
                      display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: '0.9em',
                      background: `hsl(${t.hue} 50% 25%)`, color: `hsl(${t.hue} 70% 80%)`,
                    }}>{t.id}</span>
                    {' '}{t.keyFull}
                  </span>
                ))}
              </>
            )}
          </span>
        ) : (
          <span style={{ color: '#555' }}>Hover a segment to see transitions</span>
        )}
      </div>
    </div>
  );
}
