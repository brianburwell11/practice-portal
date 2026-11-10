import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BARS, BEATS, BEATS_PER_BAR, CHART, KEY_PC, beatIndex, beatPosition, timeChart, type GridChord } from './demoSong';
import { playChordSound, useDemoTransport } from './useDemoTransport';
import { canonical } from './theory';
import { C, Row, Title, TransportBar, btn, mono, panel } from './ui';

const TOTAL = BARS * BEATS_PER_BAR;

interface Cell {
  symbol: string;
  /** Pushed: sounds half a beat early, on the "and" before this beat. */
  push?: boolean;
}

function toCells(chart: GridChord[]): Record<number, Cell> {
  const out: Record<number, Cell> = {};
  for (const c of chart) out[beatIndex(c.bar, c.beat)] = { symbol: c.symbol, push: c.push };
  return out;
}

/**
 * Input idea 1: type chords straight onto the tapMap's beat grid.
 * Space = next beat, Tab = next bar, Shift goes back. `/` repeats the last
 * chord on this beat, `%` copies the previous bar, `<` pushes the chord to
 * the "and" before. Lowercase is fine.
 */
export function GridTypingEditor() {
  const [cells, setCells] = useState<Record<number, Cell>>({ 0: { symbol: 'G' } });
  const [cursor, setCursor] = useState(0);
  const [buffer, setBuffer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ typed: string; stored: string }[]>([]);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const chart = useMemo<GridChord[]>(
    () =>
      Object.entries(cells)
        .map(([k, c]) => ({ bar: Math.floor(+k / BEATS_PER_BAR), beat: +k % BEATS_PER_BAR, symbol: c.symbol, push: c.push }))
        .sort((a, b) => beatIndex(a.bar, a.beat) - beatIndex(b.bar, b.beat)),
    [cells],
  );
  const timed = useMemo(() => timeChart(chart), [chart]);
  const t = useDemoTransport(timed);
  const playBeat = Math.floor(beatPosition(t.position));

  const prevChordBefore = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (cells[k]) return cells[k].symbol;
    return null;
  };

  /** Store the buffer at the cursor. Returns false if it isn't a chord. */
  const commit = (): boolean => {
    if (!buffer) return true;
    const stored = canonical(buffer, KEY_PC);
    if (!stored) {
      setError(`"${buffer}" isn't a chord I know`);
      return false;
    }
    setCells((c) => ({ ...c, [cursor]: { symbol: stored, push: c[cursor]?.push } }));
    setLog((l) => [{ typed: buffer, stored }, ...l].slice(0, 6));
    playChordSound(stored, 0.12);
    setBuffer('');
    setError(null);
    return true;
  };

  const move = (to: number) => setCursor(Math.max(0, Math.min(TOTAL - 1, to)));

  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (t.playing) t.pause();
      else {
        t.seek(BEATS[cursor] - 0.3);
        t.play();
      }
      return;
    }
    if (mod) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (commit()) move(cursor + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (!commit()) return;
      const barStart = cursor - (cursor % BEATS_PER_BAR);
      move(e.shiftKey ? (cursor === barStart ? barStart - BEATS_PER_BAR : barStart) : barStart + BEATS_PER_BAR);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (commit()) move(cursor + (e.key === 'ArrowRight' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setBuffer('');
      setError(null);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (buffer) setBuffer(buffer.slice(0, -1));
      else
        setCells((c) => {
          const n = { ...c };
          delete n[cursor];
          return n;
        });
    } else if (e.key === '/' && !buffer) {
      e.preventDefault();
      const prev = prevChordBefore(cursor);
      if (prev) setCells((c) => ({ ...c, [cursor]: { symbol: prev } }));
      move(cursor + 1);
    } else if (e.key === '%' && !buffer) {
      e.preventDefault();
      const barStart = cursor - (cursor % BEATS_PER_BAR);
      if (barStart > 0) {
        setCells((c) => {
          const n = { ...c };
          for (let b = 0; b < BEATS_PER_BAR; b++) {
            const src = c[barStart - BEATS_PER_BAR + b];
            if (src) n[barStart + b] = src;
            else delete n[barStart + b];
          }
          return n;
        });
      }
      move(barStart + BEATS_PER_BAR);
    } else if (e.key === '<') {
      e.preventDefault();
      if (!commit()) return;
      setCells((c) => (c[cursor] ? { ...c, [cursor]: { ...c[cursor], push: !c[cursor].push } } : c));
    } else if (e.key.length === 1) {
      e.preventDefault();
      setBuffer(buffer + e.key);
      setError(null);
    }
  };

  const heldAt = (i: number) => {
    for (let k = i; k >= 0; k--) if (cells[k]) return k;
    return -1;
  };

  return (
    <div style={panel}>
      <Title hint="Click the grid, then type. Space next beat, Tab next bar, Shift to go back, / repeats the last chord, % copies the previous bar, < pushes a chord to the “and” before (marked ›), Cmd/Ctrl+Enter plays from the cursor.">
        Type chords on the beat grid
      </Title>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          outline: focused ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
          borderRadius: 8, padding: 8, background: C.bg2,
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', rowGap: 8,
        }}
      >
        {Array.from({ length: BARS }, (_, bar) => (
          <div key={bar} style={{ display: 'grid', gridTemplateColumns: `repeat(${BEATS_PER_BAR}, 1fr)`, borderLeft: `2px solid ${C.muted}`, position: 'relative' }}>
            <span style={{ position: 'absolute', top: -1, left: 3, fontSize: 9, color: C.muted }}>{bar + 1}</span>
            {Array.from({ length: BEATS_PER_BAR }, (_, beat) => {
              const i = beatIndex(bar, beat);
              const isCursor = i === cursor;
              const chord = cells[i];
              const held = !chord && heldAt(i) >= 0;
              const sounding = playBeat >= 0 && heldAt(playBeat) === i;
              return (
                <div
                  key={beat}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    box.current?.focus();
                    if (commit()) {
                      setCursor(i);
                      t.seek(BEATS[i] - 0.01);
                    }
                  }}
                  style={{
                    height: 40, display: 'flex', alignItems: 'flex-end', padding: '0 3px 5px',
                    borderRight: `1px dashed ${C.border}`, cursor: 'text', position: 'relative',
                    background: isCursor && focused ? 'rgba(123,104,238,0.25)' : 'transparent',
                    borderBottom: playBeat === i ? `3px solid ${C.warm}` : '3px solid transparent',
                  }}
                >
                  {isCursor && buffer ? (
                    <span style={{ ...mono, fontSize: 13, color: error ? C.bad : C.text }}>
                      {buffer}
                      <span style={{ opacity: 0.6 }}>▏</span>
                    </span>
                  ) : chord ? (
                    <span style={{ fontWeight: 700, fontSize: 13, color: sounding ? C.warm : C.text, whiteSpace: 'nowrap' }}>
                      {chord.push && <span style={{ color: C.warm, marginRight: 1 }} title="Pushed">›</span>}
                      {chord.symbol}
                    </span>
                  ) : held ? (
                    <span style={{ color: C.border, fontSize: 13 }}>·</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Row style={{ marginTop: 10, minHeight: 28 }}>
        {error ? (
          <span style={{ color: C.bad, fontSize: 13 }}>{error}. Esc to clear.</span>
        ) : log.length ? (
          <span style={{ fontSize: 13, color: C.muted }}>
            {log.map((l, i) => (
              <span key={i} style={{ marginRight: 14, opacity: i === 0 ? 1 : 0.6 }}>
                <span style={mono}>{l.typed}</span> → <b style={{ color: C.text }}>{l.stored}</b>
              </span>
            ))}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: C.muted }}>
            Try sloppy spellings: <span style={mono}>am7</span>, <span style={mono}>c-7</span>, <span style={mono}>Bbmaj7</span>,{' '}
            <span style={mono}>f#ø</span>, <span style={mono}>d/f#</span>, <span style={mono}>nc</span>
          </span>
        )}
      </Row>
      <Row style={{ marginTop: 6 }}>
        <button type="button" style={btn} onClick={() => setCells(toCells(CHART))}>Fill in the real chart</button>
        <button type="button" style={btn} onClick={() => { setCells({}); setCursor(0); setLog([]); }}>Clear</button>
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
