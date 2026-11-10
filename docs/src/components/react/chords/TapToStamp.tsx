import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { KEY_PC, TIMED, barBeatLabel, snapTime, type Snap, type TimedChord } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { canonical } from './theory';
import { C, Label, Row, Seg, Title, TransportBar, btn, fmt, mono, panel } from './ui';

const PLAIN = TIMED.map((c) => c.symbol).join(' ');

const CHORDPRO = `{title: Morning Light}
{key: G}
{comment: Intro, free time}
[Cmaj7]    [D7sus4]
[G]  Morning light across the [Em7]kitchen floor
Coffee's cold, I'm [Cmaj7]running late once [D/F#]more
[G]Radio is playing [Am7]something [D7]slow
[C]Hold on, [D]hold on
[Bm7]Every little thing will [Em7]find its way
[C]Hold on, [D/F#]hold on
[G]Let it [Em]ride an[Am7]other [D7sus4]day [G]`;

/** Chords from a plain list ("G Em7 | C D") or a ChordPro sheet ("[G]words"). */
function extract(text: string): string[] {
  if (text.includes('[')) return [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  return text.split(/[\s|,]+/).filter(Boolean);
}

/**
 * Input idea 2: the Lyrics Editor's flow, for chords. Write or paste the
 * progression, play, and press Tab on each change. With a tapMap, stamps can
 * snap to the nearest beat. The demo knows the right answer, so it shows how
 * far off each stamp landed.
 */
export function TapToStamp() {
  const [text, setText] = useState(PLAIN);
  const [stamps, setStamps] = useState<(number | null)[]>([]);
  const [snap, setSnap] = useState<Snap>('half');
  const [focused, setFocused] = useState(false);
  const pad = useRef<HTMLDivElement>(null);

  const symbols = useMemo(() => extract(text).map((s) => ({ raw: s, stored: canonical(s, KEY_PC) })), [text]);
  const nextIdx = stamps.length;

  const timed = useMemo<TimedChord[]>(
    () =>
      stamps
        .map((time, i) => (time === null ? null : { time, symbol: symbols[i]?.stored ?? '' }))
        .filter((c): c is TimedChord => !!c && !!c.symbol)
        .sort((a, b) => a.time - b.time),
    [stamps, symbols],
  );
  const t = useDemoTransport(timed);

  const stamp = () => {
    if (nextIdx >= symbols.length) return;
    const raw = t.now();
    setStamps((s) => [...s, snapTime(raw, snap)]);
  };
  const back = () => setStamps((s) => s.slice(0, -1));

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) back();
      else stamp();
    } else if (e.key === ' ') {
      e.preventDefault();
      t.toggle();
    }
  };

  // The demo's answer key: only meaningful when the progression matches the chart.
  const truth = (i: number) => (TIMED[i] && TIMED[i].symbol === symbols[i]?.stored ? TIMED[i].time : null);
  const errors = stamps
    .map((s, i) => (s !== null && truth(i) !== null ? Math.abs(s - (truth(i) as number)) * 1000 : null))
    .filter((x): x is number => x !== null);
  const avg = errors.length ? Math.round(errors.reduce((a, b) => a + b, 0) / errors.length) : null;

  return (
    <div style={panel} onKeyDown={onKey}>
      <Title hint="The song opens with two free-time chords (no tapMap there, so they never snap), and three chords are pushed onto the and. Try Beat vs ½ beat snap and watch the average miss. Paste a plain list or a ChordPro sheet, click the pad, play, and press Tab on each change (Shift+Tab to undo, Space to play or pause).">
        Tap to stamp, like the Lyrics Editor
      </Title>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setStamps([]);
        }}
        rows={text.includes('\n') ? 6 : 2}
        style={{
          ...mono, width: '100%', fontSize: 12.5, background: C.bg2, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, resize: 'vertical',
        }}
      />
      <Row style={{ marginTop: 6 }}>
        <button type="button" style={btn} onClick={() => { setText(PLAIN); setStamps([]); }}>Plain list</button>
        <button type="button" style={btn} onClick={() => { setText(CHORDPRO); setStamps([]); }}>Paste ChordPro example</button>
        <Label>{symbols.length} chords found{symbols.some((s) => !s.stored) ? ', some not recognized (red)' : ''}</Label>
      </Row>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, margin: '10px 0' }}>
        {symbols.map((s, i) => (
          <span
            key={i}
            style={{
              padding: '3px 8px', borderRadius: 5, fontSize: 13, fontWeight: 600,
              background: i === nextIdx ? C.accentDark : i < nextIdx ? C.bg3 : C.bg2,
              border: `1px solid ${!s.stored ? C.bad : i === nextIdx ? C.accent : C.border}`,
              color: !s.stored ? C.bad : i < nextIdx ? C.muted : C.text,
            }}
          >
            {s.stored ?? s.raw}
          </span>
        ))}
      </div>

      <div
        ref={pad}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={(e) => {
          e.preventDefault();
          pad.current?.focus();
          if (t.playing) stamp();
          else t.play();
        }}
        style={{
          height: 80, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: focused ? 'rgba(123,104,238,0.18)' : C.bg2, cursor: 'pointer', userSelect: 'none',
          outline: focused ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: 12, color: C.muted }}>
          {!t.playing ? 'Click to start playing, then tap or press Tab' : nextIdx < symbols.length ? 'Tap or press Tab when this chord starts' : 'All chords stamped'}
        </div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{symbols[nextIdx]?.stored ?? '✓'}</div>
      </div>

      <Row style={{ marginTop: 10 }}>
        <Label>Snap</Label>
        <Seg
          value={snap}
          onChange={setSnap}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'beat', label: 'Beat' },
            { value: 'half', label: '½ beat' },
            { value: 'quarter', label: '¼ beat' },
          ]}
        />
        <button type="button" style={btn} onClick={back} disabled={!stamps.length}>Undo last</button>
        <button type="button" style={btn} onClick={() => { setStamps([]); t.seek(0); }}>Start over</button>
        {avg !== null && (
          <span style={{ fontSize: 13 }}>
            Average miss: <b style={{ color: avg < 40 ? C.good : avg < 120 ? C.warm : C.bad }}>{avg} ms</b>
          </span>
        )}
      </Row>

      {stamps.length > 0 && (
        <div style={{ marginTop: 10, maxHeight: 160, overflowY: 'auto', fontSize: 12.5 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: 'left' }}>
                <th style={{ padding: '2px 6px' }}>Chord</th>
                <th style={{ padding: '2px 6px' }}>Stamped</th>
                <th style={{ padding: '2px 6px' }}>Bar.beat</th>
                <th style={{ padding: '2px 6px' }}>Off by</th>
              </tr>
            </thead>
            <tbody>
              {stamps.map((s, i) => {
                const tr = truth(i);
                const off = s !== null && tr !== null ? Math.round((s - tr) * 1000) : null;
                return (
                  <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '2px 6px', fontWeight: 600 }}>{symbols[i]?.stored}</td>
                    <td style={{ padding: '2px 6px', ...mono }}>{s !== null ? fmt(s) : '-'}</td>
                    <td style={{ padding: '2px 6px', ...mono }}>{s !== null ? barBeatLabel(s + 0.001) : '-'}</td>
                    <td style={{ padding: '2px 6px', ...mono, color: off === null ? C.muted : Math.abs(off) < 40 ? C.good : Math.abs(off) < 120 ? C.warm : C.bad }}>
                      {off === null ? 'n/a' : `${off > 0 ? '+' : ''}${off} ms`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <TransportBar t={t} />
    </div>
  );
}
