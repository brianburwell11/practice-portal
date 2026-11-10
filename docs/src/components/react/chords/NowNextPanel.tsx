import { useEffect, useRef, useState } from 'react';
import { BEATS, BEATS_PER_BAR, LYRICS, SONG_END, TIMED, beatPosition, isFreeTime, lastAtOrBefore, type TimedChord } from './demoSong';
import { useDemoTransport } from './useDemoTransport';
import { C, Label, Row, Seg, Title, TransportBar, panel } from './ui';

type Countdown = 'dots' | 'numbers' | 'bar' | 'none';
type Layout = 'fixed' | 'scroll';
type Where = 'panel' | 'desktop' | 'phone';

/** Size of the scrolling strip. The slot's right edge is the hit line. */
interface StripSize {
  slotW: number;
  height: number;
  nowPx: number;
  nextPx: number;
  /** Lane mode: no NOW label, chord sits against the hit line. */
  lane?: boolean;
}

const PANEL: StripSize = { slotW: 180, height: 160, nowPx: 56, nextPx: 30 };
/** Same as the app's FOCUS_LEFT_NUDGE_PX: the lyric reading point. */
const FOCUS_LEFT_NUDGE_PX = 24;

/** Beats until the next chord, and how long the current one lasts. */
function countdownState(position: number, cur: TimedChord | null, next: TimedChord | null) {
  // In free time there are no beats to count, so progress runs on seconds.
  if (next && (isFreeTime(position) || isFreeTime(cur?.time ?? 0))) {
    const start = cur?.time ?? 0;
    const frac = Math.max(0, Math.min(1, (position - start) / (next.time - start)));
    return { pos: frac, nextBeat: 1, beatsLeft: Infinity, span: 1, changeSoon: next.time - position < 0.5, free: true };
  }
  const pos = beatPosition(position);
  const nextBeat = next ? beatPosition(next.time) : Infinity;
  const beatsLeft = next ? Math.ceil(nextBeat - pos - 1e-6) : Infinity;
  const span = next ? Math.max(1, Math.round(nextBeat - (cur ? beatPosition(cur.time) : 0))) : 1;
  return { pos, nextBeat, beatsLeft, span, changeSoon: beatsLeft <= 1, free: false };
}

/**
 * Display idea 1: big current chord plus what's coming. Two layouts:
 * a fixed now / next pair, or a strip where upcoming chords scroll in from
 * the right at a constant speed, spaced by time, and replace the current
 * chord the moment they reach it. The countdown and "show next" options
 * work in both.
 */
export function NowNextPanel() {
  const t = useDemoTransport(TIMED);
  const [layout, setLayout] = useState<Layout>('scroll');
  const [where, setWhere] = useState<Where>('desktop');
  const [countdown, setCountdown] = useState<Countdown>('none');
  const [lead, setLead] = useState<number>(99);
  const [ahead, setAhead] = useState<number>(5);
  const [beatTicks, setBeatTicks] = useState(true);

  const idx = lastAtOrBefore(TIMED, t.position);
  const cur = idx >= 0 ? TIMED[idx] : null;
  const next = TIMED[idx + 1] ?? null;
  const scrolling = layout === 'scroll' || where !== 'panel';
  const scrollOnly = { opacity: scrolling ? 1 : 0.4, pointerEvents: scrolling ? 'auto' : 'none' } as const;
  const stripProps = { position: t.position, idx, ahead, beatTicks, countdown, lead };

  return (
    <div style={panel}>
      <Title hint="The view most players would use. Fixed shows the next chord beside the current one. Scrolling brings chords in from the right at a steady speed, so the gap between them is how long each one lasts.">
        Now / next
      </Title>

      {where !== 'panel' ? (
        <SongViewMock {...stripProps} phone={where === 'phone'} />
      ) : layout === 'fixed' ? (
        <FixedView position={t.position} cur={cur} next={next} countdown={countdown} lead={lead} />
      ) : (
        <ScrollView {...stripProps} size={PANEL} />
      )}

      <Row style={{ marginTop: 10 }}>
        <Label>Show it</Label>
        <Seg
          value={where}
          onChange={setWhere}
          options={[
            { value: 'desktop', label: 'As a lane (desktop)' },
            { value: 'phone', label: 'As a lane (phone)' },
            { value: 'panel', label: 'As a panel' },
          ]}
        />
      </Row>
      <Row style={{ marginTop: 8, opacity: where === 'panel' ? 1 : 0.4, pointerEvents: where === 'panel' ? 'auto' : 'none' }}>
        <Label>Layout</Label>
        <Seg
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'fixed', label: 'Fixed now / next' },
            { value: 'scroll', label: 'Scrolling' },
          ]}
        />
      </Row>
      <Row style={{ marginTop: 8 }}>
        <Label>Countdown (dropped, kept to compare)</Label>
        <Seg
          value={countdown}
          onChange={setCountdown}
          options={[
            { value: 'dots', label: 'Beat dots' },
            { value: 'numbers', label: 'Number' },
            { value: 'bar', label: 'Progress' },
            { value: 'none', label: 'None' },
          ]}
        />
        <Label>Show next</Label>
        <Seg
          value={lead}
          onChange={setLead}
          options={[
            { value: 2, label: '2 beats early' },
            { value: 4, label: '1 bar' },
            { value: 99, label: 'Always' },
          ]}
        />
      </Row>
      <Row style={{ marginTop: 8, ...scrollOnly }}>
        <Label>Look ahead</Label>
        <Seg
          value={ahead}
          onChange={setAhead}
          options={[
            { value: 3, label: '3 s' },
            { value: 5, label: '5 s' },
            { value: 8, label: '8 s' },
            { value: 12, label: '12 s' },
          ]}
        />
        <label style={{ fontSize: 13, display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={beatTicks} onChange={(e) => setBeatTicks(e.target.checked)} />
          Beat and bar lines
        </label>
        {!scrolling && <Label>(scrolling only)</Label>}
      </Row>
      <TransportBar t={t} beats={BEATS} />
    </div>
  );
}

function CountdownMarks({
  kind, position, cur, next, center = true,
}: {
  kind: Countdown;
  position: number;
  cur: TimedChord | null;
  next: TimedChord | null;
  center?: boolean;
}) {
  if (!next || kind === 'none') return <div style={{ height: 26 }} />;
  const { pos, nextBeat, beatsLeft, span, changeSoon, free } = countdownState(position, cur, next);
  const dots = Math.min(span, 8);
  if (free && kind !== 'bar') {
    return (
      <div style={{ height: 26, display: 'flex', justifyContent: center ? 'center' : 'flex-start', alignItems: 'center', fontSize: 12, color: C.muted, fontStyle: 'italic' }}>
        free time
      </div>
    );
  }
  return (
    <div style={{ height: 26, display: 'flex', justifyContent: center ? 'center' : 'flex-start', alignItems: 'center', gap: 5 }}>
      {kind === 'dots' &&
        Array.from({ length: dots }, (_, i) => {
          const lit = i >= dots - Math.min(beatsLeft, dots);
          return (
            <span
              key={i}
              style={{ width: 10, height: 10, borderRadius: 5, background: lit ? (changeSoon ? C.warm : C.accent) : 'rgba(255,255,255,0.1)' }}
            />
          );
        })}
      {kind === 'numbers' && (
        <span style={{ fontSize: 22, fontWeight: 700, color: changeSoon ? C.warm : C.accent }}>
          {beatsLeft <= BEATS_PER_BAR * 2 ? beatsLeft : ''}
        </span>
      )}
      {kind === 'bar' && (
        <span style={{ width: 110, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
          <span
            style={{
              display: 'block', height: '100%',
              width: `${Math.max(0, Math.min(1, 1 - (nextBeat - pos) / span)) * 100}%`,
              background: changeSoon ? C.warm : C.accent,
            }}
          />
        </span>
      )}
    </div>
  );
}

function FixedView({
  position, cur, next, countdown, lead,
}: {
  position: number;
  cur: TimedChord | null;
  next: TimedChord | null;
  countdown: Countdown;
  lead: number;
}) {
  const { beatsLeft, changeSoon, free } = countdownState(position, cur, next);
  const showNext = next && (lead === 99 || free || beatsLeft <= lead);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28,
        background: C.bg2, borderRadius: 10, padding: '20px 12px', minHeight: 150,
      }}
    >
      <div style={{ textAlign: 'center', minWidth: 150 }}>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1 }}>NOW</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{cur ? cur.symbol : '·'}</div>
      </div>
      <div style={{ textAlign: 'center', minWidth: 120, opacity: showNext ? 1 : 0.15, transition: 'opacity 150ms' }}>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1 }}>NEXT</div>
        <div style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.1, color: changeSoon ? C.warm : C.text, transition: 'color 100ms' }}>
          {next ? next.symbol : 'End'}
        </div>
        <div style={{ marginTop: 6 }}>
          <CountdownMarks kind={countdown} position={position} cur={cur} next={next} />
        </div>
      </div>
    </div>
  );
}

interface StripProps {
  position: number;
  idx: number;
  ahead: number;
  beatTicks: boolean;
  countdown: Countdown;
  lead: number;
}

function ScrollView({ position, idx, ahead, beatTicks, countdown, lead, size }: StripProps & { size: StripSize }) {
  const { slotW: SLOT_W, nowPx: NOW_PX, nextPx: NEXT_PX, lane } = size;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Constant speed: the lane right of the hit line shows `ahead` seconds.
  const pps = Math.max(20, (width - SLOT_W) / ahead);
  const x = (time: number) => SLOT_W + (time - position) * pps;
  const cur = idx >= 0 ? TIMED[idx] : null;
  const next = TIMED[idx + 1] ?? null;
  const upcoming = TIMED.slice(idx + 1).filter((c) => c.time - position <= ahead + 1);
  const posBeat = beatPosition(position);

  return (
    <div
      ref={box}
      style={{ position: 'relative', height: size.height, overflow: 'hidden', background: C.bg2, borderRadius: lane ? 0 : 10 }}
    >
      <style>{'@keyframes chordArrive{from{transform:translateX(18px) scale(.6);opacity:.5}to{transform:none;opacity:1}}'}</style>

      {/* beat and bar lines in the lane */}
      {beatTicks &&
        BEATS.map((b, i) => {
          const bx = x(b);
          if (b < position || bx > width + 2) return null;
          const down = i % BEATS_PER_BAR === 0;
          return (
            <div
              key={i}
              style={{
                position: 'absolute', left: bx, bottom: 0, width: down ? 2 : 1,
                height: down ? '100%' : lane ? 12 : 26, background: down ? '#333338' : '#2A2A2E',
              }}
            >
              {down && !lane && (
                <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, color: C.muted }}>
                  {i / BEATS_PER_BAR + 1}
                </span>
              )}
            </div>
          );
        })}

      {/* upcoming chords: left edge sits on their start time. "Show next"
          keeps chords faint until they're within that many beats. */}
      {upcoming.map((c) => {
        const cx = x(c.time);
        const near = Math.max(0, Math.min(1, 1 - (cx - SLOT_W) / 90));
        const scale = 1 + near * (NOW_PX / NEXT_PX - 1) * 0.35;
        const beatsAway = beatPosition(c.time) - posBeat;
        const shown = lead === 99 || isFreeTime(c.time) || beatsAway <= lead;
        return (
          <div
            key={c.time}
            style={{
              position: 'absolute', left: cx, top: 0, bottom: 0, display: 'flex', alignItems: 'center',
              borderLeft: `2px solid ${near > 0.5 ? C.warm : C.accent}`, paddingLeft: lane ? 5 : 8,
              opacity: (shown ? 1 : 0.18) * Math.min(1, (width - cx) / 80 + 0.15),
              transition: 'opacity 150ms',
            }}
          >
            <span
              style={{
                fontSize: NEXT_PX, fontWeight: 600, whiteSpace: 'nowrap', color: near > 0.5 ? C.warm : C.text,
                transform: `scale(${scale})`, transformOrigin: 'left center', display: 'inline-block',
              }}
            >
              {c.symbol}
            </span>
          </div>
        );
      })}

      {/* the fixed now slot; covers anything that has already passed */}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: SLOT_W,
          background: C.bg3, borderRight: `3px solid ${C.warm}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          alignItems: lane ? 'flex-end' : 'flex-start', paddingLeft: 14, paddingRight: lane ? 8 : 0,
        }}
      >
        {!lane && <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1 }}>NOW</div>}
        <div
          key={cur?.time ?? 'none'}
          style={{
            fontSize: cur && cur.symbol.length > 4 ? NOW_PX * 0.72 : NOW_PX, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap',
            animation: 'chordArrive 140ms ease-out', transformOrigin: 'right center',
          }}
        >
          {cur ? cur.symbol : '·'}
        </div>
        {lane ? (
          <LaneProgress kind={countdown} position={position} cur={cur} next={next} />
        ) : (
          <CountdownMarks kind={countdown} position={position} cur={cur} next={next} center={false} />
        )}
      </div>
    </div>
  );
}

/** The lane's countdown: a thin bar along the bottom of the now slot. */
function LaneProgress({ kind, position, cur, next }: { kind: Countdown; position: number; cur: TimedChord | null; next: TimedChord | null }) {
  if (!next || kind === 'none') return null;
  const { pos, nextBeat, span, changeSoon, free, beatsLeft } = countdownState(position, cur, next);
  if (kind !== 'bar') {
    return <div style={{ fontSize: 11, color: changeSoon ? C.warm : C.muted }}>{free ? 'free time' : beatsLeft <= 8 ? `${beatsLeft} beats` : ''}</div>;
  }
  const frac = Math.max(0, Math.min(1, 1 - (nextBeat - pos) / span));
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,0.08)' }}>
      <div style={{ height: '100%', width: `${frac * 100}%`, background: changeSoon ? C.warm : C.accent }} />
    </div>
  );
}

/** Rough label width, for the push-off. Good enough for chord names. */
function labelW(symbol: string, px: number): number {
  return symbol.length * px * 0.62 + 10;
}

/**
 * Desktop lane, lined up with the lyrics: the current chord's left edge sits
 * on the reading point, like the current lyric. Upcoming chords scroll in
 * from the right at a constant speed; when the next one gets close it pushes
 * the current chord off to the left (like a sticky header), and its own left
 * edge reaches the reading point exactly when it sounds. The previous chord
 * fades out to the left, like the previous lyric.
 */
function PinnedLane({ position, idx, ahead, beatTicks, countdown, lead, readingX: readingPoint, height }: StripProps & { readingX: number; height: number }) {
  // Chord labels have a 2px border and 5px padding; start the border just
  // left of the reading point so the chord's text lines up with the lyric's.
  const readingX = readingPoint - 7;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const NOW = 28;
  const NEXT = 19;
  const GAP = 14;
  const pps = Math.max(20, (width - readingX) / ahead);
  const x = (time: number) => readingX + (time - position) * pps;
  const cur = idx >= 0 ? TIMED[idx] : null;
  const prev = idx >= 1 ? TIMED[idx - 1] : null;
  const next = TIMED[idx + 1] ?? null;
  const upcoming = TIMED.slice(idx + 1).filter((c) => c.time - position <= ahead + 1);
  const posBeat = beatPosition(position);

  // Current chord: pinned on the reading point until the next one shoves it.
  const curW = cur ? labelW(cur.symbol, NOW) : 0;
  const curX = next ? Math.min(readingX, x(next.time) - curW - GAP) : readingX;
  // Previous chord stays the size it was, just faded, so the hand-off doesn't jump.
  const prevX = prev ? Math.min(readingX, curX) - labelW(prev.symbol, NOW) - GAP : 0;
  const cd = countdownState(position, cur, next);
  const frac = next ? Math.max(0, Math.min(1, 1 - (cd.nextBeat - cd.pos) / cd.span)) : 0;

  return (
    <div ref={box} style={{ position: 'relative', height, overflow: 'hidden', background: C.bg2 }}>
      {beatTicks &&
        BEATS.map((b, i) => {
          const bx = x(b);
          if (bx < readingX - 2 || bx > width + 2) return null;
          const down = i % BEATS_PER_BAR === 0;
          return (
            <div
              key={i}
              style={{ position: 'absolute', left: bx, bottom: 0, width: down ? 2 : 1, height: down ? '100%' : 12, background: down ? '#333338' : '#2A2A2E' }}
            />
          );
        })}

      {prev && (
        <span
          style={{
            position: 'absolute', left: prevX, top: '50%', transform: 'translateY(-50%)',
            fontSize: NOW, fontWeight: 700, color: C.muted, opacity: 0.4, whiteSpace: 'nowrap',
          }}
        >
          {prev.symbol}
        </span>
      )}

      {upcoming.map((c) => {
        const cx = x(c.time);
        const shown = lead === 99 || isFreeTime(c.time) || beatPosition(c.time) - posBeat <= lead;
        const near = c === next && cx - readingX < 70;
        // The next chord grows to full size as it reaches the reading point.
        const grow = c === next ? Math.max(0, Math.min(1, 1 - (cx - readingX) / 70)) : 0;
        return (
          <div
            key={c.time}
            style={{
              position: 'absolute', left: cx, top: 0, bottom: 0, display: 'flex', alignItems: 'center',
              borderLeft: `2px solid ${near ? C.warm : C.accent}`, paddingLeft: 5,
              opacity: (shown ? 1 : 0.18) * Math.min(1, (width - cx) / 80 + 0.15),
            }}
          >
            <span
              style={{
                fontSize: NEXT, fontWeight: 600, whiteSpace: 'nowrap', color: near ? C.warm : C.text, display: 'inline-block',
                transform: `scale(${1 + grow * (NOW / NEXT - 1)})`, transformOrigin: 'left center',
              }}
            >
              {c.symbol}
            </span>
          </div>
        );
      })}

      {cur && (
        <div
          style={{
            position: 'absolute', left: curX, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
            borderLeft: `2px solid ${C.warm}`, paddingLeft: 5,
          }}
        >
          <span style={{ fontSize: NOW, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.1 }}>{cur.symbol}</span>
          {next && countdown === 'bar' && (
            <span style={{ display: 'block', width: Math.max(40, curW - 10), height: 3, marginTop: 4, background: 'rgba(255,255,255,0.1)' }}>
              <span style={{ display: 'block', height: '100%', width: `${frac * 100}%`, background: cd.changeSoon ? C.warm : C.accent }} />
            </span>
          )}
          {next && (countdown === 'dots' || countdown === 'numbers') && (
            <span style={{ fontSize: 10.5, color: cd.changeSoon ? C.warm : C.muted }}>
              {cd.free ? 'free time' : cd.beatsLeft <= 8 ? `${cd.beatsLeft} beats` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const NOTES = [
  { time: 20.2, text: 'Watch the push into the chorus' },
  { time: 37.5, text: 'Drums drop out here' },
];

/**
 * The chord lane where it would live: under the waveform and notes, above
 * the lyrics. On desktop the current chord starts on the lyric reading
 * point, like the current lyric (PinnedLane). Phones have no room left of
 * the waveform, and lyrics run vertically there anyway, so the lane gets
 * its own slot.
 */
function SongViewMock(props: StripProps & { phone: boolean }) {
  const { position, phone } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const controlsW = phone ? 0 : Math.round(Math.min(240, width * 0.3));
  const waveLeft = phone ? 0 : controlsW + 8;
  const readingX = waveLeft + FOCUS_LEFT_NUDGE_PX;
  const lineIdx = lastAtOrBefore(LYRICS, position);
  const note = NOTES.find((n) => position >= n.time - 2 && position <= n.time + 4);
  const rowLabel = (text: string) => (
    <span style={{ position: 'absolute', right: 6, top: 3, fontSize: 9.5, color: C.muted, letterSpacing: 0.5 }}>{text}</span>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        ref={box}
        style={{
          position: 'relative', width: phone ? 380 : '100%', maxWidth: '100%', background: C.bg2,
          borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`,
        }}
      >
        {/* transport + waveform */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 0', height: 64, alignItems: 'stretch' }}>
          {!phone && (
            <div style={{ width: controlsW, display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 10 }}>
              {['▶', '⟲', 'Vol', 'Speed'].map((l) => (
                <span key={l} style={{ padding: '4px 8px', borderRadius: 5, background: C.bg3, fontSize: 11, color: C.muted }}>{l}</span>
              ))}
            </div>
          )}
          <div style={{ flex: 1, position: 'relative', background: C.bg3, borderRadius: 4, overflow: 'hidden' }}>
            {Array.from({ length: 80 }, (_, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute', bottom: '50%', left: `${(i / 80) * 100}%`, width: 2,
                  height: `${18 + 26 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23))}%`,
                  transform: 'translateY(50%)', background: '#5A4FCF', opacity: 0.7,
                }}
              />
            ))}
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: `${(position / SONG_END) * 100}%`, width: 2, background: C.text }} />
            {rowLabel('WAVEFORM')}
          </div>
        </div>

        {/* notes */}
        <div style={{ position: 'relative', height: 36, borderTop: `1px solid ${C.border}` }}>
          {note && (
            <span
              style={{
                position: 'absolute', left: readingX, top: 6, padding: '3px 8px', fontSize: 11.5, borderRadius: 3,
                background: '#E8D27A', color: '#222', whiteSpace: 'nowrap',
              }}
            >
              {note.text}
            </span>
          )}
          {rowLabel('NOTES')}
        </div>

        {/* chord lane */}
        <div style={{ position: 'relative', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
          {phone ? (
            <ScrollView {...props} size={{ slotW: 110, height: 58, nowPx: 28, nextPx: 19, lane: true }} />
          ) : (
            <PinnedLane {...props} readingX={readingX} height={58} />
          )}
          {rowLabel('CHORDS')}
        </div>

        {/* lyrics */}
        {phone ? (
          <div style={{ position: 'relative', padding: '10px 14px 14px', minHeight: 78 }}>
            {[lineIdx, lineIdx + 1].map((i, k) =>
              i >= 0 && i < LYRICS.length ? (
                <div key={i} style={{ fontSize: k === 0 ? 17 : 15, fontWeight: k === 0 ? 600 : 400, color: k === 0 ? C.text : C.muted, marginTop: k ? 4 : 0 }}>
                  {LYRICS[i].text}
                </div>
              ) : null,
            )}
            {rowLabel('LYRICS')}
          </div>
        ) : (
          <div style={{ position: 'relative', height: 48, overflow: 'hidden' }}>
            {lineIdx > 0 && (
              <span style={{ position: 'absolute', right: width - readingX + 24, top: 14, fontSize: 15, color: C.muted, whiteSpace: 'nowrap' }}>
                {LYRICS[lineIdx - 1].text}
              </span>
            )}
            <span style={{ position: 'absolute', left: readingX, top: 14, display: 'flex', gap: 28, whiteSpace: 'nowrap' }}>
              {LYRICS.slice(Math.max(0, lineIdx), Math.max(0, lineIdx) + 3).map((l, k) => (
                <span key={l.time} style={{ fontSize: 15, fontWeight: k === 0 && lineIdx >= 0 ? 700 : 400, color: k === 0 && lineIdx >= 0 ? C.text : C.muted }}>
                  {l.text}
                </span>
              ))}
            </span>
            {rowLabel('LYRICS')}
          </div>
        )}

        {/* the shared reading point */}
        {!phone && (
          <div
            style={{
              position: 'absolute', left: readingX - 1, top: 8, bottom: 0, width: 0,
              borderLeft: `1px dashed ${C.warm}`, opacity: 0.45, pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  );
}
