import { useMemo, useRef, useState } from 'react';
import { BEATS, BEATS_PER_BAR, LYRICS, SONG_END, TIMED, lastAtOrBefore } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { C, Label, Row, Title, TransportBar, panel } from './ui';

const PLAYHEAD_X = 24; // FOCUS_LEFT_NUDGE_PX in the app
const LABEL_PAD = 14;
const CHAR_PX = 8.5;

/** Fake waveform peaks, deterministic. */
const PEAKS = Array.from({ length: 900 }, (_, i) => {
  const t = (i / 900) * SONG_END;
  const nearBeat = BEATS.some((b) => t >= b && t - b < 0.08);
  return 0.25 + 0.35 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.13)) + (nearBeat ? 0.35 : 0);
});

/**
 * Display idea 2: a chord lane on the waveform, scrolling under a fixed
 * playhead. Zoom out and crowded chords collapse Capo-style to "…Am".
 */
export function ChordLane() {
  const t = useDemoTransport(TIMED);
  const [pxPerSec, setPxPerSec] = useState(60);
  const [collapse, setCollapse] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  const x = (time: number) => PLAYHEAD_X + (time - t.position) * pxPerSec;
  const width = SONG_END * pxPerSec;

  // Walk left to right; any chord that would overlap the previous label
  // joins its group, and only the group's last chord is drawn ("…Am").
  const labels = useMemo(() => {
    const out: { time: number; text: string; hidden: number }[] = [];
    for (const c of TIMED) {
      const prev = out[out.length - 1];
      if (collapse && prev) {
        const prevEnd = prev.time * pxPerSec + prev.text.length * CHAR_PX + LABEL_PAD;
        if (c.time * pxPerSec < prevEnd) {
          out[out.length - 1] = { time: c.time, text: `…${c.symbol}`, hidden: prev.hidden + 1 };
          continue;
        }
      }
      out.push({ time: c.time, text: c.symbol, hidden: 0 });
    }
    return out;
  }, [pxPerSec, collapse]);

  const activeLabel = lastAtOrBefore(labels, t.position);
  const lyricIdx = lastAtOrBefore(LYRICS, t.position);

  const onClick = (e: React.MouseEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    t.seek(t.position + (e.clientX - r.left - PLAYHEAD_X) / pxPerSec);
  };

  return (
    <div style={panel}>
      <Title hint="An editing-style view: chords in a strip above the waveform, aligned with the lyric reading point. Click the lane to seek.">
        Chord lane on the waveform
      </Title>
      <div
        ref={boxRef}
        onClick={onClick}
        style={{ position: 'relative', height: 128, overflow: 'hidden', background: C.bg2, borderRadius: 8, cursor: 'pointer' }}
      >
        {/* bar lines */}
        {BEATS.map((b, i) =>
          i % BEATS_PER_BAR === 0 ? (
            <div key={i} style={{ position: 'absolute', left: x(b), top: 0, bottom: 0, width: 1, background: C.border }}>
              <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 9, color: C.muted }}>{i / BEATS_PER_BAR + 1}</span>
            </div>
          ) : null,
        )}
        {/* chord lane */}
        <div style={{ position: 'absolute', top: 16, left: 0, right: 0, height: 26 }}>
          {labels.map((l, i) => {
            const active = i === activeLabel;
            return (
              <div
                key={l.time}
                title={l.hidden ? `${l.hidden} chord(s) hidden at this zoom` : undefined}
                style={{
                  position: 'absolute', left: x(l.time), top: 0, height: 24, padding: '0 6px',
                  display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                  borderLeft: `2px solid ${active ? C.warm : C.accent}`,
                  background: active ? 'rgba(212,168,67,0.18)' : 'rgba(123,104,238,0.14)',
                  fontWeight: 600, fontSize: 13, color: active ? C.warm : C.text,
                }}
              >
                {l.text}
              </div>
            );
          })}
        </div>
        {/* waveform */}
        <svg
          style={{ position: 'absolute', left: x(0), top: 48, height: 52 }}
          width={width}
          height={52}
          viewBox={`0 0 ${PEAKS.length} 52`}
          preserveAspectRatio="none"
        >
          {PEAKS.map((p, i) => (
            <rect key={i} x={i} y={26 - p * 24} width={0.7} height={p * 48} fill="#5A4FCF" opacity={0.7} />
          ))}
        </svg>
        {/* lyric strip */}
        <div style={{ position: 'absolute', top: 104, left: 0, right: 0, height: 20 }}>
          {LYRICS.map((l, i) => (
            <span
              key={i}
              style={{
                position: 'absolute', left: x(l.time), fontSize: 12, whiteSpace: 'nowrap',
                color: i === lyricIdx ? C.text : C.muted, fontWeight: i === lyricIdx ? 600 : 400,
              }}
            >
              {l.text}
            </span>
          ))}
        </div>
        {/* playhead */}
        <div style={{ position: 'absolute', left: PLAYHEAD_X, top: 0, bottom: 0, width: 2, background: C.warm }} />
      </div>
      <Row style={{ marginTop: 10 }}>
        <Label>Zoom</Label>
        <input
          type="range"
          min={8}
          max={160}
          value={pxPerSec}
          onChange={(e) => setPxPerSec(Number(e.target.value))}
          style={{ width: 160, accentColor: 'var(--accent, #7B68EE)' }}
        />
        <span style={{ fontSize: 12, color: C.muted }}>{pxPerSec}px/s</span>
        <label style={{ fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} />
          Collapse crowded chords (…Am)
        </label>
      </Row>
      <TransportBar t={t} />
    </div>
  );
}
