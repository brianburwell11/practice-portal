import { useMemo, useState } from 'react';
import { BEATS, BEATS_PER_BAR, BPM, CHART, beatIndex, beatPosition, chartPos, makeBeats, snapTime, timeAtPos } from './demoSong';
import { C, Label, Row, Seg, Title, btn, panel } from './ui';

const FIRST_BAR = 4;
const LAST_BAR = 12; // exclusive
const MISSED_BAR = 6; // 0-based: "bar 7"
const QUARTER_BEAT_MS = Math.round((60 / BPM / 4) * 1000);

type Scenario = 'retime' | 'insert';

/**
 * Data-model question: store chords as bar/beat anchors, as seconds, or as
 * seconds that get re-snapped to the beat grid? Two kinds of tapMap edit:
 * nudging taps (anchors win) and inserting a bar that was missed (anchors
 * lose). Each lane is green where the chord lands where it should.
 */
export function BeatAnchorDemo() {
  const [scenario, setScenario] = useState<Scenario>('retime');
  const [shift, setShift] = useState(180);
  const [stretch, setStretch] = useState(1);

  const { oldBeats, newBeats } = useMemo(() => {
    if (scenario === 'retime') {
      // The old taps were sloppy; the edit moves them to where the beats really are.
      return { oldBeats: BEATS, newBeats: makeBeats({ stretch, shiftFromBar: 8, shiftBy: shift / 1000 }) };
    }
    // The old map skipped a bar; the edit adds it back. The audio didn't move.
    const skip = beatIndex(MISSED_BAR, 0);
    return {
      oldBeats: BEATS.filter((_, i) => i < skip || i >= skip + BEATS_PER_BAR),
      newBeats: BEATS,
    };
  }, [scenario, shift, stretch]);

  const chords = CHART.filter((c) => c.bar >= FIRST_BAR && c.bar < LAST_BAR).map((c) => {
    const p = chartPos(c);
    const label = (c.push ? '›' : '') + c.symbol;
    if (scenario === 'retime') {
      // Entered against the old taps, so they sat on the old beat times.
      const stored = timeAtPos(oldBeats, p);
      return {
        symbol: label,
        target: timeAtPos(newBeats, p),
        anchored: timeAtPos(newBeats, p),
        seconds: stored,
        snapped: snapTime(stored, 'half', newBeats),
      };
    }
    // Entered at the right time; the anchor is its position in the old (short) map.
    const t = timeAtPos(BEATS, p);
    return {
      symbol: label,
      target: t,
      anchored: timeAtPos(newBeats, beatPosition(t, oldBeats)),
      seconds: t,
      snapped: snapTime(t, 'half', newBeats),
    };
  });

  const t0 = Math.min(newBeats[beatIndex(FIRST_BAR, 0)], BEATS[beatIndex(FIRST_BAR, 0)]) - 0.2;
  const t1 = Math.max(newBeats[beatIndex(LAST_BAR, 0)], BEATS[beatIndex(LAST_BAR, 0)]) + 0.2;
  const W = 1000;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;

  const lane = (y: number, label: string, key: 'anchored' | 'seconds' | 'snapped') => {
    const bad = chords.filter((c) => Math.abs(c[key] - c.target) >= 0.03).length;
    return (
      <g>
        <text x={4} y={y - 20} fontSize={13} fill={C.muted}>
          {label}{' '}
          <tspan fill={bad ? C.bad : C.good}>{bad ? `${bad} of ${chords.length} wrong` : 'all right'}</tspan>
        </text>
        {chords.map((c, i) => {
          const ct = c[key];
          const off = Math.round((ct - c.target) * 1000);
          const ok = Math.abs(off) < 30;
          return (
            <g key={i}>
              <line x1={x(ct)} x2={x(ct)} y1={y - 12} y2={y + 14} stroke={ok ? C.good : C.bad} strokeWidth={2.5} />
              <text x={x(ct) + 4} y={y + 2} fontSize={14} fontWeight={700} fill={C.text}>{c.symbol}</text>
              {!ok && (
                <text x={x(ct) + 4} y={y + 16} fontSize={10.5} fill={C.bad}>
                  {off > 0 ? '+' : ''}{off}ms
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  };

  return (
    <div style={panel}>
      <Title
        hint={
          scenario === 'retime'
            ? 'The chords were entered on the old taps. Then someone fixes the taps from bar 9 on. Where should the chords end up?'
            : 'The old tapMap missed bar 7, so everything after it was numbered one bar low. Someone adds the bar back. The audio didn\'t move, so neither should the chords.'
        }
      >
        Anchors, seconds, or seconds + re-snap?
      </Title>
      <Row style={{ marginBottom: 10 }}>
        <Label>tapMap edit</Label>
        <Seg
          value={scenario}
          onChange={setScenario}
          options={[
            { value: 'retime', label: 'Nudge taps' },
            { value: 'insert', label: 'Add a missed bar' },
          ]}
        />
      </Row>
      <svg viewBox={`0 0 ${W} 290`} style={{ width: '100%', height: 'auto', background: C.bg2, borderRadius: 8, display: 'block' }}>
        <text x={4} y={20} fontSize={13} fill={C.muted}>tapMap after the edit</text>
        {newBeats.map((b, i) => {
          if (b < t0 || b > t1) return null;
          const down = i % BEATS_PER_BAR === 0;
          const added = scenario === 'insert' && Math.floor(i / BEATS_PER_BAR) === MISSED_BAR;
          return (
            <g key={i}>
              <line x1={x(b)} x2={x(b)} y1={28} y2={down ? 56 : 46} stroke={added ? C.warm : down ? C.text : C.muted} strokeWidth={down ? 2 : 1} />
              {down && <text x={x(b) + 3} y={56} fontSize={11} fill={added ? C.warm : C.muted}>{i / BEATS_PER_BAR + 1}{added ? ' (added)' : ''}</text>}
              <line x1={x(b)} x2={x(b)} y1={60} y2={290} stroke={down ? '#333' : '#262628'} strokeWidth={1} />
            </g>
          );
        })}
        {lane(110, 'A. Bar + beat anchors, times re-derived:', 'anchored')}
        {lane(185, 'B. Seconds only, untouched:', 'seconds')}
        {lane(260, 'C. Seconds, re-snapped to the nearest half beat:', 'snapped')}
      </svg>
      {scenario === 'retime' && (
        <Row style={{ marginTop: 10 }}>
          <Label>Move bar 9 onward</Label>
          <input type="range" min={-600} max={600} step={10} value={shift} onChange={(e) => setShift(+e.target.value)} style={{ width: 170, accentColor: 'var(--accent, #7B68EE)' }} />
          <span style={{ fontSize: 12, color: Math.abs(shift) >= QUARTER_BEAT_MS ? C.bad : C.muted, minWidth: 64 }}>
            {shift > 0 ? '+' : ''}{shift} ms
          </span>
          <Label>Stretch whole map</Label>
          <input type="range" min={0.94} max={1.06} step={0.005} value={stretch} onChange={(e) => setStretch(+e.target.value)} style={{ width: 150, accentColor: 'var(--accent, #7B68EE)' }} />
          <span style={{ fontSize: 12, color: C.muted, minWidth: 44 }}>{Math.round((stretch - 1) * 1000) / 10}%</span>
          <button type="button" style={btn} onClick={() => { setShift(0); setStretch(1); }}>No edit</button>
        </Row>
      )}
      <div style={{ marginTop: 8, fontSize: 12.5, color: C.muted }}>
        {scenario === 'retime'
          ? `Re-snapping (C) to half beats, so pushes survive, only works while every tap moves less than a quarter beat (${QUARTER_BEAT_MS} ms here). Past that, chords snap to the wrong half beat. › marks a pushed chord.`
          : 'Anchors (A) point at bar numbers, so adding or deleting a bar shifts every chord after it. Seconds (B and C) don\'t care.'}
      </div>
    </div>
  );
}
