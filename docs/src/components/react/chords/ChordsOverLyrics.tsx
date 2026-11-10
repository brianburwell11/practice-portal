import { useState } from 'react';
import { BEATS, LYRICS, SONG_END, TIMED, lastAtOrBefore } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { C, Label, Row, Seg, Title, TransportBar, panel } from './ui';

type Placement = 'proportional' | 'word';

interface Placed {
  symbol: string;
  time: number;
  frac: number;
  word: number;
}

/** Chords inside each lyric line's time span, with where they'd sit. */
function placeChords(): Placed[][] {
  return LYRICS.map((line, li) => {
    const start = line.time;
    const end = LYRICS[li + 1]?.time ?? SONG_END;
    const words = line.text.split(' ');
    // Character offset where each word starts, as a fraction of the line.
    const starts: number[] = [];
    let acc = 0;
    for (const w of words) {
      starts.push(acc / line.text.length);
      acc += w.length + 1;
    }
    return TIMED.filter((c) => (li === 0 ? c.time >= BEATS[0] - 0.01 && c.time < end : c.time >= start && c.time < end)).map((c) => {
      const frac = Math.max(0, Math.min(0.97, (c.time - start) / (end - start)));
      let word = 0;
      starts.forEach((s, i) => {
        if (Math.abs(s - frac) < Math.abs(starts[word] - frac)) word = i;
      });
      return { symbol: c.symbol, time: c.time, frac, word };
    });
  });
}

const PLACED = placeChords();

/**
 * Display idea 3: chords over the lyrics. We have line timing, not word
 * timing, so a chord's spot in the line is an estimate. Compare placing it
 * in proportion to its time with snapping it to the nearest word.
 */
export function ChordsOverLyrics() {
  const t = useDemoTransport(TIMED);
  const [placement, setPlacement] = useState<Placement>('word');
  const [showAll, setShowAll] = useState(false);

  const lineIdx = Math.max(0, lastAtOrBefore(LYRICS, t.position));
  const chordIdx = lastAtOrBefore(TIMED, t.position);
  const activeTime = chordIdx >= 0 ? TIMED[chordIdx].time : -1;
  const visible = showAll
    ? LYRICS.map((_, i) => i)
    : [lineIdx - 1, lineIdx, lineIdx + 1].filter((i) => i >= 0 && i < LYRICS.length);

  return (
    <div style={panel}>
      <Title hint="For singers and rhythm players. Lines are timed, words aren't, so chord placement inside a line is an estimate.">
        Chords over lyrics
      </Title>
      <div style={{ background: C.bg2, borderRadius: 8, padding: '6px 16px 12px', minHeight: 190 }}>
        {visible.map((li) => {
          const line = LYRICS[li];
          const chords = PLACED[li];
          const current = li === lineIdx && t.position >= LYRICS[0].time - 2;
          const chordStyle = (c: Placed) => ({
            position: 'absolute' as const,
            top: 0,
            fontWeight: 700,
            fontSize: 14,
            whiteSpace: 'nowrap' as const,
            color: c.time === activeTime ? C.warm : C.accent,
          });
          const words = line.text.split(' ');
          return (
            <div
              key={li}
              style={{
                position: 'relative', display: 'block', paddingTop: 22, marginTop: 8,
                opacity: current ? 1 : 0.45, transition: 'opacity 200ms',
              }}
            >
              {placement === 'proportional' ? (
                <span style={{ position: 'relative', display: 'inline-block', fontSize: 20, fontWeight: current ? 600 : 400 }}>
                  {chords.map((c) => (
                    <span key={c.time} style={{ ...chordStyle(c), top: -22, left: `${c.frac * 100}%` }}>
                      {c.symbol}
                    </span>
                  ))}
                  {line.text}
                </span>
              ) : (
                <span style={{ fontSize: 20, fontWeight: current ? 600 : 400 }}>
                  {words.map((w, wi) => {
                    const here = chords.filter((c) => c.word === wi);
                    return (
                      <span key={wi} style={{ position: 'relative', display: 'inline-block', marginRight: '0.28em' }}>
                        {here.map((c, k) => (
                          <span key={c.time} style={{ ...chordStyle(c), top: -22, left: k * 44 }}>
                            {c.symbol}
                          </span>
                        ))}
                        {w}
                      </span>
                    );
                  })}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Row style={{ marginTop: 10 }}>
        <Label>Place chords</Label>
        <Seg
          value={placement}
          onChange={setPlacement}
          options={[
            { value: 'proportional', label: 'By time in line' },
            { value: 'word', label: 'Snap to nearest word' },
          ]}
        />
        <label style={{ fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show every line
        </label>
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
