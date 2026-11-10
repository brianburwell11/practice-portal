import { useState } from 'react';
import { playChordSound } from './useDemoTransport';
import { formatChord, noteName, parseChord } from './theory';
import { C, ChordText, Label, Row, Seg, Title, btn, mono, panel } from './ui';

interface Key {
  tonic: number;
  minor: boolean;
}

interface Section {
  name: string;
  key: Key;
  /** Which key this section would get if the editor didn't mark it. */
  optional?: boolean;
  bars: string[];
}

const G: Key = { tonic: 7, minor: false };

const SONG: Section[] = [
  { name: 'Verse', key: G, bars: ['G', 'D/F#', 'Em7', 'C', 'G', 'D', 'C', 'D'] },
  { name: 'Pre-chorus', key: { tonic: 4, minor: true }, optional: true, bars: ['Em', 'C', 'Am7', 'B7'] },
  { name: 'Chorus', key: G, bars: ['C', 'G/B', 'Am7', 'D7sus4', 'Bb', 'C', 'D', 'D'] },
  { name: 'Last chorus', key: { tonic: 8, minor: false }, bars: ['Db', 'Ab/C', 'Bbm7', 'Eb7sus4', 'B', 'Db', 'Eb', 'Ab'] },
];

type Show = 'nashville' | 'roman' | 'letters';
type KeyMode = 'one' | 'map';
type MinorStyle = 'relative' | 'tonic';

function keyName(k: Key, shift: number): string {
  const relMajor = k.minor ? k.tonic + 3 : k.tonic;
  return noteName(k.tonic + shift, relMajor + shift) + (k.minor ? 'm' : '');
}

/**
 * Nashville numbers only mean something against a key. This sketch has a
 * borrowed chord, a section in the relative minor, and a last chorus up a
 * half step, so you can see what each choice does to the numbers.
 */
export function NashvilleKeys() {
  const [show, setShow] = useState<Show>('nashville');
  const [mode, setMode] = useState<KeyMode>('map');
  const [minorStyle, setMinorStyle] = useState<MinorStyle>('relative');
  const [markPre, setMarkPre] = useState(true);
  const [transpose, setTranspose] = useState(0);

  const keyFor = (s: Section): Key => {
    if (mode === 'one') return G;
    if (s.optional && !markPre) return G;
    return s.key;
  };

  let prevKey: Key | null = null;

  return (
    <div style={panel}>
      <Title hint="Chords are stored as letters, and a key map says which key each part is in. Numbers are worked out from both. Click a chord to hear it.">
        Nashville numbers and key changes
      </Title>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', alignItems: 'center', marginBottom: 12 }}>
        <Label>Show</Label>
        <Row>
          <Seg value={show} onChange={setShow} options={[
            { value: 'nashville', label: 'Nashville' },
            { value: 'roman', label: 'Roman' },
            { value: 'letters', label: 'Letters' },
          ]} />
        </Row>
        <Label>Numbers relative to</Label>
        <Row>
          <Seg value={mode} onChange={setMode} options={[
            { value: 'one', label: 'Song key (G) throughout' },
            { value: 'map', label: 'Key map' },
          ]} />
        </Row>
        <Label>Minor keys</Label>
        <Row>
          <Seg value={minorStyle} onChange={setMinorStyle} options={[
            { value: 'relative', label: 'From relative major (Em = 6m)' },
            { value: 'tonic', label: 'From minor tonic (Em = 1m)' },
          ]} />
        </Row>
        <Label>Key map</Label>
        <Row>
          <label style={{ fontSize: 13, display: 'flex', gap: 5, alignItems: 'center', opacity: mode === 'map' ? 1 : 0.4 }}>
            <input type="checkbox" checked={markPre} disabled={mode !== 'map'} onChange={(e) => setMarkPre(e.target.checked)} />
            Mark the pre-chorus as E minor (the numbers only change when minor keys count from the tonic)
          </label>
        </Row>
        <Label>Transpose</Label>
        <Row>
          <button type="button" style={{ ...btn, padding: '4px 9px' }} onClick={() => setTranspose(Math.max(-6, transpose - 1))}>−</button>
          <span style={{ ...mono, fontSize: 13, minWidth: 40, textAlign: 'center' }}>{transpose > 0 ? '+' : ''}{transpose} st</span>
          <button type="button" style={{ ...btn, padding: '4px 9px' }} onClick={() => setTranspose(Math.min(6, transpose + 1))}>+</button>
          <Label>Letters move, numbers stay put.</Label>
        </Row>
      </div>

      {SONG.map((s) => {
        const k = keyFor(s);
        const changed = prevKey && (prevKey.tonic !== k.tonic || prevKey.minor !== k.minor);
        const from = prevKey;
        prevKey = k;
        const relMajor = k.minor ? (k.tonic + 3) % 12 : k.tonic;
        const numKey = k.minor && minorStyle === 'tonic' ? k.tonic : relMajor;
        const minorTonic = k.minor && minorStyle === 'tonic';
        const up = from ? (((k.tonic - from.tonic) % 12) + 12) % 12 : 0;
        return (
          <div key={s.name} style={{ marginBottom: 10 }}>
            <Row style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: C.muted }}>key {keyName(k, transpose)}</span>
              {changed && from && (
                <span style={{ fontSize: 11.5, padding: '1px 7px', borderRadius: 10, background: 'rgba(212,168,67,0.18)', color: C.warm }}>
                  key change {keyName(from, transpose)} → {keyName(k, transpose)}
                  {!k.minor && !from.minor && up ? ` (up ${up === 1 ? 'a half step' : up === 2 ? 'a whole step' : `${up} semitones`})` : ''}
                </span>
              )}
            </Row>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
              {s.bars.map((sym, i) => {
                const c = parseChord(sym)!;
                const letters = formatChord(c, { keyPc: relMajor, transpose });
                const main =
                  show === 'letters'
                    ? letters
                    : formatChord(c, { keyPc: numKey, minorTonic, notation: show });
                const outside = show !== 'letters' && /^[b#]/.test(main);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => playChordSound(sym, 0.12)}
                    style={{
                      width: 78, padding: '6px 4px', textAlign: 'center', cursor: 'pointer',
                      background: C.bg2, color: C.text, border: 'none',
                      borderLeft: `2px solid ${i % 4 === 0 ? C.muted : C.border}`, fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 17, fontWeight: 700, color: outside ? C.warm : C.text }}><ChordText text={main} /></div>
                    {show !== 'letters' && <div style={{ fontSize: 10.5, color: C.muted, ...mono }}>{letters}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <Label>Orange numbers are outside the key (borrowed or chromatic). Try "Song key throughout" and watch the last chorus fill with flats.</Label>
    </div>
  );
}
