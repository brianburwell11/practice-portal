import { useState } from 'react';
import { CHART, KEY_PC, TIMED, lastAtOrBefore } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { formatChord, noteName, parseChord, type Simplify, type Spelling } from './theory';
import { C, ChordText, Label, Row, Seg, Title, TransportBar, btn, mono, panel } from './ui';

type Notation = 'letters' | 'nashville' | 'roman';

const STORED = [...CHART.map((c) => c.symbol), 'Cmaj9', 'F#m7b5', 'B7b9', 'Eadd9'].filter(
  (s, i, a) => a.indexOf(s) === i,
);

/**
 * Display settings: transpose, capo, notation, simplify and spelling are all
 * applied at render time. The stored chords never change.
 */
export function DisplaySettings() {
  const t = useDemoTransport(TIMED);
  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [notation, setNotation] = useState<Notation>('letters');
  const [simplify, setSimplify] = useState<Simplify>('full');
  const [spelling, setSpelling] = useState<Spelling>('auto');

  const opts = { transpose, capo, keyPc: KEY_PC, notation, simplify, spelling };
  const show = (s: string) => {
    const c = parseChord(s);
    return c ? formatChord(c, opts) : s;
  };
  const sounding = noteName(KEY_PC + transpose, KEY_PC + transpose, spelling);
  const shapes = noteName(KEY_PC + transpose - capo, KEY_PC + transpose - capo, spelling);
  const curIdx = lastAtOrBefore(TIMED, t.position);
  const cur = curIdx >= 0 ? TIMED[curIdx].symbol : null;

  const stepper = (v: number, set: (n: number) => void, min: number, max: number, unit: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button type="button" style={{ ...btn, padding: '4px 9px' }} onClick={() => set(Math.max(min, v - 1))}>−</button>
      <span style={{ ...mono, minWidth: 54, textAlign: 'center', fontSize: 13 }}>
        {v > 0 && unit !== 'fret' ? '+' : ''}{v} {unit}
      </span>
      <button type="button" style={{ ...btn, padding: '4px 9px' }} onClick={() => set(Math.min(max, v + 1))}>+</button>
    </span>
  );

  return (
    <div style={panel}>
      <Title hint="Every setting here is per listener and only changes what you see. The stored row underneath never moves.">
        Transpose, capo, numbers, simplify
      </Title>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', alignItems: 'center' }}>
        <Label>Transpose</Label>
        <Row>{stepper(transpose, setTranspose, -6, 6, 'st')}</Row>
        <Label>Capo</Label>
        <Row>{stepper(capo, setCapo, 0, 7, 'fret')}</Row>
        <Label>Show as</Label>
        <Row>
          <Seg value={notation} onChange={setNotation} options={[
            { value: 'letters', label: 'Letters' },
            { value: 'nashville', label: 'Nashville' },
            { value: 'roman', label: 'Roman' },
          ]} />
        </Row>
        <Label>Simplify</Label>
        <Row>
          <Seg value={simplify} onChange={setSimplify} options={[
            { value: 'full', label: 'Full' },
            { value: 'seventh', label: '7ths' },
            { value: 'triad', label: 'Triads' },
          ]} />
        </Row>
        <Label>Spelling</Label>
        <Row>
          <Seg value={spelling} onChange={setSpelling} options={[
            { value: 'auto', label: 'By key' },
            { value: 'sharps', label: '♯' },
            { value: 'flats', label: '♭' },
          ]} />
        </Row>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: C.muted }}>
        Sounding key: <b style={{ color: C.text }}>{sounding}</b>
        {capo > 0 && notation === 'letters' && (
          <> · Shapes in <b style={{ color: C.text }}>{shapes}</b> with capo {capo}</>
        )}
        {notation !== 'letters' && <> · Numbers are relative to the key, so transpose and capo don't change them</>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {STORED.map((s) => {
          const playing = s === cur;
          return (
            <div
              key={s}
              style={{
                minWidth: 64, padding: '6px 8px', borderRadius: 6, textAlign: 'center',
                background: playing ? 'rgba(212,168,67,0.18)' : C.bg2,
                border: `1px solid ${playing ? C.warm : C.border}`,
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 700, color: playing ? C.warm : C.text }}><ChordText text={show(s)} /></div>
              <div style={{ ...mono, fontSize: 10.5, color: C.muted, marginTop: 2 }}>stored: {s}</div>
            </div>
          );
        })}
      </div>
      <Row style={{ marginTop: 8 }}>
        <button
          type="button"
          style={btn}
          onClick={() => { setTranspose(0); setCapo(0); setNotation('letters'); setSimplify('full'); setSpelling('auto'); }}
        >
          Reset
        </button>
        <Label>The playing chord lights up. The synth plays the stored chords: there's no audio transpose yet.</Label>
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
