import type { ReactNode } from 'react';

const HUES: Record<number, number> = {
  1: 50, 2: 80, 3: 120, 4: 155, 5: 180, 6: 200,
  7: 225, 8: 260, 9: 295, 10: 330, 11: 0, 12: 25,
};

// [camelotNum]: [major root semitone, minor root semitone]
const ROOTS: Record<number, [number, number]> = {
  1: [11, 8], 2: [6, 3], 3: [1, 10], 4: [8, 5], 5: [3, 0], 6: [10, 7],
  7: [5, 2], 8: [0, 9], 9: [7, 4], 10: [2, 11], 11: [9, 6], 12: [4, 1],
};

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

interface Props {
  c: string;
  children: ReactNode;
}

export function KeyBadge({ c, children }: Props) {
  const match = c.match(/^(\d{1,2})([AB])$/i);
  if (!match) return <span>{children}</span>;

  const num = parseInt(match[1], 10);
  const isMinor = match[2].toUpperCase() === 'A';
  const hue = HUES[num];
  if (hue === undefined) return <span>{children}</span>;

  const rootMidi = 48 + ROOTS[num][isMinor ? 1 : 0];

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => playTriad(rootMidi, isMinor)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') playTriad(rootMidi, isMinor); }}
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 4,
        fontSize: '0.88em',
        background: `hsl(${hue} 50% 25%)`,
        color: `hsl(${hue} 70% 80%)`,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title={`Click to hear ${c}`}
    >
      {children}
    </span>
  );
}
