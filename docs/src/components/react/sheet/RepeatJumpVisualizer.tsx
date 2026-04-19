import { useMemo, useState } from 'react';

interface MeasureSpec {
  /** Display label e.g. "1", "2a", "2b" */
  label: string;
  /** Measure number in the "as notated" view */
  number: number;
  /** Marker — segno, coda, fine */
  marker?: 'segno' | 'coda' | 'fine';
  /** Volta: 1 = first ending, 2 = second ending, etc. */
  volta?: number;
  /** Repeat barlines */
  startRepeat?: boolean;
  endRepeat?: boolean;
  /** Jump applied at the end of this measure */
  jump?: 'dc' | 'ds' | 'dscoda' | 'tocoda';
  /** Highlight in unfolded view if true (for hover sync) */
}

/**
 * A small synthetic 16-measure example with repeats, voltas, segno + coda,
 * and a D.S. al coda jump. Real scores compose these markings in messy ways;
 * this is enough to demonstrate the playback ordering algorithm.
 */
const EXAMPLE: MeasureSpec[] = [
  { label: '1', number: 1 },
  { label: '2', number: 2 },
  { label: '3', number: 3, startRepeat: true, marker: 'segno' },
  { label: '4', number: 4 },
  { label: '5', number: 5 },
  { label: '6', number: 6, volta: 1, endRepeat: true },
  { label: '7', number: 7, volta: 2 },
  { label: '8', number: 8, marker: 'coda' /* "coda destination" — see below */ },
  { label: '9', number: 9 },
  { label: '10', number: 10 },
  { label: '11', number: 11 },
  { label: '12', number: 12, jump: 'dscoda', marker: 'fine' },
  // After D.S. al coda, jump to the segno (m.3), play to "to coda" (the
  // marker-bearing coda above — m.8), then jump to the coda section:
  { label: '13', number: 13 /* coda section start — modeled here as continuation */ },
  { label: '14', number: 14 },
  { label: '15', number: 15 },
  { label: '16', number: 16 },
];

/**
 * Unfold the sequence into a linear list of measure references — the order
 * an audio player would actually visit them.
 *
 * This is a deliberately stripped-down version of the algorithm used by
 * MuseScore's Repeat List / Verovio's expansion / OSMD's RepeatHandler.
 */
function unfoldSequence(measures: MeasureSpec[]): { srcIndex: number; visitN: number }[] {
  const out: { srcIndex: number; visitN: number }[] = [];
  const segnoIdx = measures.findIndex((m) => m.marker === 'segno');
  const toCodaIdx = measures.findIndex((m) => m.marker === 'coda');
  // We fake the coda destination: in our example m.13 is where we jump to.
  const codaDestIdx = measures.findIndex((m, i) => i > toCodaIdx && m.number >= 13);

  let i = 0;
  let dsTaken = false;

  while (i < measures.length) {
    const m = measures[i];

    // Skip volta endings on the wrong pass
    if (m.volta) {
      const prevEndRepeat = out.length > 0 && hasRecentEndRepeat(measures, i, out);
      const passNumber = countVisitsToVolta(measures, i, out);
      if (m.volta !== passNumber) {
        // Find the next volta with the matching number, or skip past the volta block
        const next = findNextVoltaOrAfter(measures, i, passNumber);
        i = next;
        continue;
      }
    }

    // Visit count for this measure
    const visitN = out.filter((v) => v.srcIndex === i).length + 1;
    out.push({ srcIndex: i, visitN });

    // End of measure: handle jumps and repeats
    if (m.endRepeat) {
      // Find the matching start repeat, go back to it
      const start = findMatchingStartRepeat(measures, i);
      // Avoid infinite loop: only repeat once
      const alreadyRepeated = out.filter((v) => v.srcIndex === start).length >= 2;
      if (!alreadyRepeated) {
        i = start;
        continue;
      }
    }
    if (m.jump === 'dscoda' && !dsTaken && segnoIdx >= 0 && toCodaIdx >= 0) {
      dsTaken = true;
      // Jump to segno; we'll play through until "to coda" then jump to coda
      i = segnoIdx;
      continue;
    }
    // After D.S. is taken, when we reach the "to coda" marker, jump to the coda.
    if (dsTaken && i === toCodaIdx && codaDestIdx >= 0) {
      // Skip the coda marker measure itself's continuation — jump past
      i = codaDestIdx;
      continue;
    }
    i++;
    if (m.marker === 'fine' && !dsTaken) break;
  }
  return out;
}

function findMatchingStartRepeat(measures: MeasureSpec[], endIdx: number): number {
  for (let i = endIdx - 1; i >= 0; i--) {
    if (measures[i].startRepeat) return i;
  }
  return 0;
}

function hasRecentEndRepeat(measures: MeasureSpec[], i: number, out: { srcIndex: number }[]): boolean {
  return out.some((v) => measures[v.srcIndex].endRepeat);
}

function countVisitsToVolta(measures: MeasureSpec[], i: number, out: { srcIndex: number }[]): number {
  // How many times have we entered the volta block? Approximated by counting
  // visits to the start-repeat that begins the section.
  const start = findMatchingStartRepeat(measures, i);
  return out.filter((v) => v.srcIndex === start).length || 1;
}

function findNextVoltaOrAfter(measures: MeasureSpec[], i: number, pass: number): number {
  for (let j = i; j < measures.length; j++) {
    const m = measures[j];
    if (!m.volta) return j;
    if (m.volta === pass) return j;
  }
  return measures.length;
}

// ─────────────────────────────────── UI ────────────────────────────────────

type View = 'notated' | 'unfolded';

export function RepeatJumpVisualizer() {
  const [view, setView] = useState<View>('notated');
  const [hover, setHover] = useState<number | null>(null);

  const unfolded = useMemo(() => unfoldSequence(EXAMPLE), []);
  const visitsBySrc = useMemo(() => {
    const m = new Map<number, number[]>();
    unfolded.forEach((v, idx) => {
      const a = m.get(v.srcIndex) || [];
      a.push(idx);
      m.set(v.srcIndex, a);
    });
    return m;
  }, [unfolded]);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      padding: '0.8rem',
      margin: '1.5rem 0',
    }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {(['notated', 'unfolded'] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '0.3rem 0.8rem',
            background: view === v ? 'var(--accent-dark)' : 'var(--bg-elevated)',
            color: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: '0.85em',
            textTransform: 'capitalize',
          }}>{v}</button>
        ))}
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8em' }}>
          {view === 'notated'
            ? 'Score as written — markings hint at playback order'
            : `Linear playback order — ${unfolded.length} measure events from ${EXAMPLE.length} written measures`}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {view === 'notated' && EXAMPLE.map((m, i) => (
          <MeasureBox key={i} m={m} isHover={hover === i} secondaryLabel={(visitsBySrc.get(i) || []).length > 1 ? `×${(visitsBySrc.get(i) || []).length}` : undefined}
            onEnter={() => setHover(i)} onLeave={() => setHover(null)} />
        ))}
        {view === 'unfolded' && unfolded.map((v, i) => {
          const m = EXAMPLE[v.srcIndex];
          return (
            <MeasureBox key={i} m={m} isHover={hover === v.srcIndex}
              secondaryLabel={v.visitN > 1 ? `pass ${v.visitN}` : undefined}
              onEnter={() => setHover(v.srcIndex)} onLeave={() => setHover(null)} />
          );
        })}
      </div>

      <div style={{ marginTop: '0.8rem', fontSize: '0.78em', color: 'var(--text-secondary)' }}>
        Markings: <Tag color="#7B68EE">⌜⌝ start/end repeat</Tag>{' '}
        <Tag color="#D4A843">𝄋 segno</Tag>{' '}
        <Tag color="#10b981">𝄌 coda</Tag>{' '}
        <Tag color="#f87171">D.S. al coda</Tag>{' '}
        <Tag color="#94a3b8">1./2. volta</Tag>
      </div>
    </div>
  );
}

function MeasureBox({
  m, isHover, secondaryLabel, onEnter, onLeave,
}: {
  m: MeasureSpec;
  isHover: boolean;
  secondaryLabel?: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const accent = m.marker === 'segno' ? '#D4A843'
    : m.marker === 'coda' ? '#10b981'
    : m.marker === 'fine' ? '#f87171'
    : m.startRepeat || m.endRepeat ? '#7B68EE'
    : m.volta ? '#94a3b8'
    : 'var(--border)';

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        padding: '0.4rem 0.5rem',
        minWidth: 56,
        textAlign: 'center',
        background: isHover ? 'var(--bg-elevated)' : 'var(--bg-primary)',
        border: `1px solid ${accent}`,
        borderLeft: m.startRepeat ? `4px double ${accent}` : `1px solid ${accent}`,
        borderRight: m.endRepeat ? `4px double ${accent}` : `1px solid ${accent}`,
        borderRadius: 3,
        fontSize: '0.78em',
        color: 'var(--text-primary)',
        fontFamily: 'ui-monospace, monospace',
        position: 'relative',
      }}
    >
      <div style={{ fontWeight: 600 }}>m.{m.number}</div>
      {m.marker && <div style={{ color: accent }}>{m.marker}</div>}
      {m.volta && <div style={{ color: accent }}>vlt {m.volta}</div>}
      {m.jump && <div style={{ color: '#f87171' }}>{m.jump}</div>}
      {secondaryLabel && <div style={{ color: 'var(--text-secondary)', fontSize: '0.95em' }}>{secondaryLabel}</div>}
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      color,
      border: `1px solid ${color}`,
      padding: '0.05rem 0.4rem',
      borderRadius: 3,
      marginRight: '0.35rem',
    }}>{children}</span>
  );
}
