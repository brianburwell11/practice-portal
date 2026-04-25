import { useState, useRef, useCallback } from 'react';

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

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

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

    // Outer ring (B = major). Key short on the rim, code closer to center.
    const outerMidR = (R_OUTER + R_MID) / 2;
    segs.push({
      id: `${n}B`,
      num: n,
      side: 'B',
      keyShort: k.major.short,
      keyFull: k.major.full,
      hue,
      rootMidi: 48 + k.major.semi,
      isMinor: false,
      path: arcPath(R_MID, R_OUTER, startDeg, endDeg),
      codePos: pt(outerMidR - 11, centerDeg),
      namePos: pt(outerMidR + 13, centerDeg),
    });

    // Inner ring (A = minor). Key short on the outer side, code closer to center.
    const innerMidR = (R_MID + R_INNER) / 2;
    segs.push({
      id: `${n}A`,
      num: n,
      side: 'A',
      keyShort: k.minor.short,
      keyFull: k.minor.full,
      hue,
      rootMidi: 48 + k.minor.semi,
      isMinor: true,
      path: arcPath(R_INNER, R_MID, startDeg, endDeg),
      codePos: pt(innerMidR - 11, centerDeg),
      namePos: pt(innerMidR + 11, centerDeg),
    });
  }
  return segs;
}

const SEGMENTS = buildSegments();
const SEG_MAP: Record<string, Segment> = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]));

type Rule = 'none' | 'same' | 'relative' | 'adjacent' | 'boost' | 'drop' | 'parallel';

const RULE_OPTIONS: { value: Rule; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'same', label: 'Seamless' },
  { value: 'relative', label: 'Mood shift' },
  { value: 'adjacent', label: 'Gentle change' },
  { value: 'boost', label: 'Energy boost' },
  { value: 'drop', label: 'Energy drop' },
  { value: 'parallel', label: 'Strong mood shift' },
];

const wrap = (n: number) => ((((n - 1) % 12) + 12) % 12) + 1;

function getTargets(sourceId: string, rule: Rule): string[] {
  if (rule === 'none') return [];
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

interface Props {
  size?: number;
}

export function CamelotWheel({ size = 320 }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [rule, setRule] = useState<Rule>('none');
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

  const targets = hovered ? getTargets(hovered, rule) : [];
  const targetSet = new Set(targets);
  const ruleActive = rule !== 'none' && hovered !== null;

  return (
    <div style={{ textAlign: 'center', position: 'relative', width: size, margin: '0 auto' }}>
      <svg viewBox="0 0 500 500" style={{ width: size, height: size, display: 'block' }}>
        {SEGMENTS.map((seg) => {
          const isHovered = hovered === seg.id;
          const isTarget = targetSet.has(seg.id) && !isHovered;
          const isActive = active === seg.id;
          const dimmed = ruleActive && !isHovered && !isTarget;
          const isOuter = seg.side === 'B';

          let lightness = 28;
          let saturation = 55;
          let opacity = 1;
          let strokeColor = `hsl(${seg.hue} 40% 15%)`;
          let strokeWidth = 1.5;

          if (isActive) {
            lightness = 45;
          } else if (isHovered) {
            lightness = 42;
            saturation = 65;
            if (rule !== 'none') {
              strokeColor = '#fff';
              strokeWidth = 2.5;
            } else {
              lightness = 35;
            }
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
          const textFill = `hsl(${seg.hue} 60% ${isHovered || isTarget || isActive ? 95 : 82}%)`;

          return (
            <g
              key={seg.id}
              onClick={() => playChord(seg)}
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
                x={seg.namePos.x}
                y={seg.namePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 13 : 11}
                fontWeight={700}
                opacity={textAlpha}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'opacity 0.15s' }}
              >
                {seg.keyShort}
              </text>
              <text
                x={seg.codePos.x}
                y={seg.codePos.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textFill}
                fontSize={isOuter ? 11 : 9}
                opacity={textAlpha}
                style={{ pointerEvents: 'none', userSelect: 'none', transition: 'opacity 0.15s' }}
              >
                {seg.id}
              </text>
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={R_INNER} fill="#111" stroke="#222" strokeWidth={1.5} />
      </svg>
      <select
        value={rule}
        onChange={(e) => setRule(e.target.value as Rule)}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: `${size * 0.27}px`,
          background: '#1a1a1a',
          color: '#aaa',
          border: '1px solid #333',
          borderRadius: 4,
          fontSize: 8,
          padding: '2px 2px',
          textAlign: 'center',
          cursor: 'pointer',
          appearance: 'none',
          textAlignLast: 'center',
        }}
      >
        {RULE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
