import { useState } from 'react';
import { BARS, BEATS, BEATS_PER_BAR, CHART, FREE_INTRO, TIMED, beatIndex, beatPosition, isFreeTime, lastAtOrBefore } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { C, Label, Row, Seg, Title, TransportBar, panel } from './ui';

type Held = 'repeat' | 'dim' | 'blank';

/**
 * Display idea 4: an iReal Pro / Moises Grid style chart. The current bar is
 * lit and a beat bar runs along its bottom. Click a bar to jump there.
 */
export function BarGridView() {
  const t = useDemoTransport(TIMED);
  const [perRow, setPerRow] = useState(4);
  const [held, setHeld] = useState<Held>('repeat');

  const pos = beatPosition(t.position);
  const free = isFreeTime(t.position);
  const curBar = free ? -1 : Math.floor(pos / BEATS_PER_BAR);
  const beatInBar = pos - curBar * BEATS_PER_BAR;
  // The sounding chord, by time, so a push lights up on its "and".
  const sounding = TIMED[lastAtOrBefore(TIMED, t.position)];

  let lastSymbol = '';
  const bars = Array.from({ length: BARS }, (_, bar) => {
    const inBar = CHART.filter((c) => c.bar === bar);
    const heldSymbol = lastSymbol;
    if (inBar.length) lastSymbol = inBar[inBar.length - 1].symbol;
    return { bar, inBar, heldSymbol };
  });

  return (
    <div style={panel}>
      <Title hint="A play-along chart for players who don't need lyrics. Same chord data, laid out by bar.">
        Bar grid with the current bar lit
      </Title>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
        <span
          style={{
            padding: '4px 10px', borderRadius: 6, color: C.muted, fontStyle: 'italic',
            outline: free ? `2px solid ${C.accent}` : 'none', background: free ? 'rgba(123,104,238,0.22)' : C.bg2,
          }}
        >
          Free time
        </span>
        {FREE_INTRO.map((c) => (
          <b key={c.time} style={{ color: sounding === c ? C.warm : C.text }}>{c.symbol}</b>
        ))}
        <span style={{ color: C.muted, fontSize: 12 }}>No bars here, so it sits outside the grid.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${perRow}, 1fr)`, gap: 0, background: C.bg2, borderRadius: 8, padding: 8 }}>
        {bars.map(({ bar, inBar, heldSymbol }) => {
          const now = bar === curBar;
          return (
            <div
              key={bar}
              onClick={() => t.seek(BEATS[beatIndex(bar, 0)] - 0.02)}
              style={{
                position: 'relative', height: 58, cursor: 'pointer',
                borderLeft: `2px solid ${bar % perRow === 0 ? C.muted : C.border}`,
                background: now ? 'rgba(123,104,238,0.22)' : 'transparent',
                outline: now ? `2px solid ${C.accent}` : 'none', outlineOffset: -2,
                display: 'grid', gridTemplateColumns: `repeat(${BEATS_PER_BAR}, 1fr)`, alignItems: 'center',
                padding: '0 6px',
              }}
            >
              <span style={{ position: 'absolute', top: 2, left: 5, fontSize: 9, color: C.muted }}>{bar + 1}</span>
              {inBar.length === 0 ? (
                <span
                  style={{
                    gridColumn: '1 / -1', textAlign: 'center',
                    fontSize: held === 'repeat' ? 20 : 17, color: C.muted,
                    fontStyle: held === 'dim' ? 'italic' : 'normal',
                  }}
                >
                  {held === 'repeat' ? '%' : held === 'dim' ? heldSymbol : ''}
                </span>
              ) : (
                inBar.map((c, i) => {
                  const end = inBar[i + 1]?.beat ?? BEATS_PER_BAR;
                  const active = !!sounding && sounding.bar === c.bar && sounding.beat === c.beat;
                  return (
                    <span
                      key={c.beat}
                      style={{
                        gridColumn: `${c.beat + 1} / ${end + 1}`,
                        fontSize: inBar.length > 1 ? 15 : 18, fontWeight: 700,
                        color: active ? C.warm : C.text, whiteSpace: 'nowrap',
                      }}
                    >
                      {c.push && <span title="Pushed: comes in on the 'and' before" style={{ color: C.warm, marginRight: 2 }}>›</span>}
                      {c.symbol}
                    </span>
                  );
                })
              )}
              {now && (
                <span
                  style={{
                    position: 'absolute', left: 0, bottom: 0, height: 3, background: C.warm,
                    width: `${(beatInBar / BEATS_PER_BAR) * 100}%`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <Row style={{ marginTop: 10 }}>
        <Label>Bars per row</Label>
        <Seg value={perRow} onChange={setPerRow} options={[{ value: 2, label: '2' }, { value: 4, label: '4' }, { value: 8, label: '8' }]} />
        <Label>Bars with no change</Label>
        <Seg
          value={held}
          onChange={setHeld}
          options={[
            { value: 'repeat', label: '%' },
            { value: 'dim', label: 'Chord, dimmed' },
            { value: 'blank', label: 'Blank' },
          ]}
        />
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
