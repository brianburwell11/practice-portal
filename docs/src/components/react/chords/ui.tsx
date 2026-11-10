import type { CSSProperties, ReactNode } from 'react';
import { barBeatLabel } from './demoSong';
import type { DemoTransport } from './useDemoTransport';

export const C = {
  bg: 'var(--bg-secondary, #141416)',
  bg2: 'var(--bg-tertiary, #1A1A1C)',
  bg3: 'var(--bg-elevated, #222224)',
  text: 'var(--text-primary, #E0DED8)',
  muted: 'var(--text-secondary, #808080)',
  accent: 'var(--accent, #7B68EE)',
  accentDark: 'var(--accent-dark, #4840A0)',
  warm: 'var(--accent-warm, #D4A843)',
  border: 'var(--border, #2A2A2C)',
  good: '#4CAF7A',
  bad: '#E06C6C',
};

export const panel: CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: 14,
  margin: '1.5rem 0',
  color: C.text,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 14,
  lineHeight: 1.4,
};

export const btn: CSSProperties = {
  background: C.bg3,
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export const btnOn: CSSProperties = { ...btn, background: C.accentDark, border: `1px solid ${C.accent}` };

export const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

export function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', ...style }}>{children}</div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span style={{ color: C.muted, fontSize: 12 }}>{children}</span>;
}

export function Seg<T extends string | number>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 0 }}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            ...(o.value === value ? btnOn : btn),
            borderRadius: i === 0 ? '6px 0 0 6px' : i === options.length - 1 ? '0 6px 6px 0' : 0,
            marginLeft: i === 0 ? 0 : -1,
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Title({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{children}</div>
      {hint && <div style={{ color: C.muted, fontSize: 12.5, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function TransportBar({ t, beats }: { t: DemoTransport; beats?: number[] }) {
  return (
    <Row style={{ marginTop: 10 }}>
      <button type="button" style={{ ...btn, width: 64 }} onClick={t.toggle}>
        {t.playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min={0}
        max={t.duration}
        step={0.01}
        value={t.position}
        onChange={(e) => t.seek(Number(e.target.value))}
        style={{ flex: '1 1 140px', accentColor: 'var(--accent, #7B68EE)' }}
        aria-label="Position"
      />
      <span style={{ ...mono, fontSize: 12, color: C.muted, minWidth: 92 }}>
        {fmt(t.position)} · {barBeatLabel(t.position, beats)}
      </span>
      <Seg
        value={t.speed}
        onChange={t.setSpeed}
        options={[
          { value: 0.5, label: '50%' },
          { value: 0.75, label: '75%' },
          { value: 1, label: '100%' },
        ]}
      />
      <button type="button" style={t.sound ? btnOn : btn} onClick={() => t.setSound(!t.sound)}>
        Chords
      </button>
      <button type="button" style={t.click ? btnOn : btn} onClick={() => t.setClick(!t.click)}>
        Click
      </button>
    </Row>
  );
}

/** A Nashville number with its quality raised, so 5 + 7sus4 doesn't read as "57sus4". */
export function ChordText({ text }: { text: string }) {
  const m = /^([b#]?[1-7])(m(?!aj))?([^/]*)(\/.*)?$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      {m[2]}
      {m[3] && <sup style={{ fontSize: '0.6em', verticalAlign: '0.7em', lineHeight: 0 }}>{m[3]}</sup>}
      {m[4]}
    </>
  );
}
