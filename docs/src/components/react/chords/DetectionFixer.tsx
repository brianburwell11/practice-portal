import { useMemo, useState } from 'react';
import { CHART, KEY_PC, GRID_TIMED as TIMED, barBeatLabel, lastAtOrBefore, type TimedChord } from './demoSong';
import { playChordSound, useDemoTransport } from './useDemoTransport';
import { canonical } from './theory';
import { C, Label, Row, Title, TransportBar, btn, btnOn, mono, panel } from './ui';

/** Fake detector output: the kind of mistakes real ones make (7ths heard as
 *  triads, missing slash basses), each with a confidence. */
const DETECTED: { symbol: string; conf: number; alts: string[] }[] = CHART.map((c, i) => {
  const wrong: Record<number, [string, number, string[]]> = {
    1: ['G', 0.48, ['Em7', 'G6', 'Em']],
    2: ['Em', 0.41, ['Cmaj7', 'Em', 'C']],
    3: ['D', 0.72, ['D/F#', 'F#m', 'D']],
    5: ['C', 0.44, ['Am7', 'C6', 'Am']],
    9: ['D', 0.46, ['Bm7', 'D6', 'Bm']],
    12: ['D', 0.7, ['D/F#', 'F#m', 'D']],
    16: ['D', 0.52, ['D7sus4', 'Dsus4', 'D7']],
  };
  const w = wrong[i];
  if (w) return { symbol: w[0], conf: w[1], alts: w[2] };
  return { symbol: c.symbol, conf: 0.84 + ((i * 37) % 13) / 100, alts: [c.symbol] };
});

interface Item {
  symbol: string;
  detected: string;
  conf: number;
  confirmed: boolean;
  alts: string[];
}

/**
 * Detection idea: results come in as suggestions, not saved chords. Fix them
 * Capo-style: ranked alternatives, search, apply to all matching.
 */
export function DetectionFixer() {
  const [items, setItems] = useState<Item[]>(() =>
    DETECTED.map((d) => ({ symbol: d.symbol, detected: d.symbol, conf: d.conf, confirmed: false, alts: d.alts })),
  );
  const [sel, setSel] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [applyAll, setApplyAll] = useState(false);

  const timed = useMemo<TimedChord[]>(() => TIMED.map((c, i) => ({ ...c, symbol: items[i].symbol })), [items]);
  const t = useDemoTransport(timed);
  const cur = lastAtOrBefore(TIMED, t.position);

  const right = items.filter((it, i) => it.symbol === CHART[i].symbol).length;
  const selItem = sel !== null ? items[sel] : null;
  const matching = selItem ? items.filter((it) => !it.confirmed && it.symbol === selItem.symbol).length : 0;

  const choose = (symbol: string) => {
    if (sel === null) return;
    const from = items[sel].symbol;
    setItems((list) =>
      list.map((it, i) =>
        i === sel || (applyAll && !it.confirmed && it.symbol === from) ? { ...it, symbol, confirmed: true } : it,
      ),
    );
    playChordSound(symbol, 0.12);
    setSearch('');
    setSel(null);
  };

  const searched = search ? canonical(search, KEY_PC) : null;

  return (
    <div style={panel}>
      <Title hint="A fake detector got 11 of 18 right. Low-confidence chords are outlined in orange. Click one, listen, and fix it. Dashed = detected, solid = confirmed by a person.">
        Fixing detected chords
      </Title>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {items.map((it, i) => {
          const low = !it.confirmed && it.conf < 0.6;
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                setSel(i);
                t.seek(TIMED[i].time - 0.4);
                if (!t.playing) playChordSound(it.symbol, 0.12);
              }}
              style={{
                ...btn, minWidth: 62, padding: '5px 7px', textAlign: 'center',
                border: `${sel === i ? 2 : 1}px ${it.confirmed ? 'solid' : 'dashed'} ${sel === i ? C.accent : low ? C.warm : it.confirmed ? C.good : C.muted}`,
                background: i === cur ? 'rgba(212,168,67,0.18)' : C.bg2,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>{it.symbol}</div>
              <div style={{ fontSize: 10, color: C.muted, ...mono }}>
                {it.confirmed ? '✓ fixed' : `${Math.round(it.conf * 100)}%`} · {barBeatLabel(TIMED[i].time + 0.001)}
              </div>
            </button>
          );
        })}
      </div>

      {selItem && sel !== null && (
        <div style={{ marginTop: 10, padding: 10, background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <Row>
            <Label>Bar {barBeatLabel(TIMED[sel].time + 0.001)}, detected as <b style={{ color: C.text }}>{selItem.detected}</b>. Likely:</Label>
            {selItem.alts.map((a) => (
              <button
                key={a}
                type="button"
                style={a === selItem.symbol ? btnOn : btn}
                onMouseEnter={() => playChordSound(a, 0.08)}
                onClick={() => choose(a)}
              >
                {a}
              </button>
            ))}
          </Row>
          <Row style={{ marginTop: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && searched) choose(searched); }}
              placeholder="Or type any chord"
              style={{ ...mono, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 5, padding: '5px 8px', width: 150 }}
            />
            {search && (searched ? (
              <button type="button" style={btn} onClick={() => choose(searched)}>Use {searched}</button>
            ) : (
              <span style={{ color: C.bad, fontSize: 12 }}>not a chord</span>
            ))}
            <label style={{ fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
              Apply to all {matching} unconfirmed “{selItem.symbol}”
            </label>
            <button type="button" style={btn} onClick={() => choose(selItem.symbol)}>It's right, confirm</button>
          </Row>
        </div>
      )}

      <Row style={{ marginTop: 10 }}>
        <span style={{ fontSize: 13 }}>
          Matches the real chart: <b style={{ color: right === CHART.length ? C.good : C.text }}>{right} / {CHART.length}</b>
        </span>
        <button
          type="button"
          style={btn}
          onClick={() => { setItems(DETECTED.map((d) => ({ symbol: d.symbol, detected: d.symbol, conf: d.conf, confirmed: false, alts: d.alts }))); setSel(null); }}
        >
          Reset
        </button>
        <Label>Hover a suggestion to hear it. Careful with apply-to-all: bar 10's D really is a D.</Label>
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
