import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BeatStamp } from './OsmdRenderer';
import { OsmdRenderer } from './OsmdRenderer';

interface Props {
  url: string;
  /** Beats per minute to drive the virtual playhead at tempo=1.0 */
  baseBpm?: number;
}

type HighlightStyle = 'bbox' | 'underline' | 'color' | 'none';

/**
 * Virtual playhead drives the scroll. We don't load any audio here — instead
 * a `requestAnimationFrame` loop advances `position` in seconds based on the
 * tempo slider, then we map position → beat → cursor index → x-offset.
 *
 * For the actual production widget the same math applies, but `position`
 * comes from `useTransportStore.getState().position` instead of our local clock.
 */
export function ScrollSyncPlayground({ url, baseBpm = 132 }: Props) {
  const [tempo, setTempo] = useState(1.0);            // multiplier
  const [lookahead, setLookahead] = useState(0.4);    // 0..1: where in viewport the playhead sits
  const [highlightStyle, setHighlightStyle] = useState<HighlightStyle>('bbox');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);        // seconds
  const [duration, setDuration] = useState(0);        // seconds
  const [timeline, setTimeline] = useState<BeatStamp[]>([]);
  const osmdRef = useRef<any>(null);
  const scrollHostRef = useRef<HTMLDivElement | null>(null);

  const handleReady = useCallback((osmd: any) => {
    osmdRef.current = osmd;
    // Hand-find the scrollable host (it's the OsmdRenderer's wrapper div).
    if (osmd?.container?.parentElement) {
      scrollHostRef.current = osmd.container.parentElement.parentElement;
    }
  }, []);

  const handleTimeline = useCallback((tl: BeatStamp[]) => {
    setTimeline(tl);
    if (tl.length > 0) {
      const lastBeat = tl[tl.length - 1].absoluteBeat;
      // Duration in seconds at base tempo
      setDuration((lastBeat / baseBpm) * 60);
    }
  }, [baseBpm]);

  // RAF clock — advance position while playing
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPosition((p) => {
        const next = p + dt * tempo;
        if (duration > 0 && next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tempo, duration]);

  // Map position → beat → cursor index → scroll
  const cursorIndex = useMemo(() => {
    if (timeline.length === 0) return 0;
    const beat = (position / 60) * baseBpm;
    return findCursorIndexForBeat(beat, timeline);
  }, [position, timeline, baseBpm]);

  // Drive the OSMD cursor and scroll the host
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || timeline.length === 0) return;

    // Throttle cursor updates: don't seek backwards every frame
    osmd.cursor.reset();
    for (let i = 0; i < cursorIndex; i++) osmd.cursor.next();
    osmd.cursor.show();

    const scrollHost = scrollHostRef.current;
    const cursorEl = osmd.cursor.cursorElement as HTMLElement | undefined;
    if (scrollHost && cursorEl) {
      const cursorLeft = cursorEl.offsetLeft;
      const target = cursorLeft - scrollHost.clientWidth * lookahead;
      // Smooth-scroll horizontally only — the cursor's vertical position
      // is handled by us scrolling vertically when it enters a new system.
      scrollHost.scrollTo({
        left: Math.max(0, target),
        top: Math.max(0, cursorEl.offsetTop - scrollHost.clientHeight * 0.4),
        behavior: 'smooth',
      });
    }

    applyHighlight(osmd, highlightStyle);
  }, [cursorIndex, timeline.length, lookahead, highlightStyle]);

  const seekToBeat = useCallback((beatFrac: number) => {
    if (timeline.length === 0) return;
    const lastBeat = timeline[timeline.length - 1].absoluteBeat;
    const beat = beatFrac * lastBeat;
    setPosition((beat / baseBpm) * 60);
  }, [timeline, baseBpm]);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s - m * 60).toFixed(1);
    return `${m}:${sec.padStart(4, '0')}`;
  };

  const beatNow = (position / 60) * baseBpm;
  const measureNow = timeline[cursorIndex]?.measureIndex ?? 0;

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      padding: '0.8rem',
      margin: '1.5rem 0',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1.2rem', marginBottom: '0.8rem', fontSize: '0.85em' }}>
        <Control label={`Tempo · ${(tempo * 100).toFixed(0)}% (${(baseBpm * tempo).toFixed(0)} BPM)`}>
          <input type="range" min="0.25" max="2" step="0.05" value={tempo}
            onChange={(e) => setTempo(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </Control>
        <Control label={`Lookahead · ${(lookahead * 100).toFixed(0)}% from left edge`}>
          <input type="range" min="0" max="0.9" step="0.05" value={lookahead}
            onChange={(e) => setLookahead(parseFloat(e.target.value))} style={{ width: '100%' }} />
        </Control>
        <Control label="Highlight style">
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['bbox', 'underline', 'color', 'none'] as HighlightStyle[]).map((s) => (
              <button key={s} onClick={() => setHighlightStyle(s)}
                style={{
                  padding: '0.25rem 0.6rem',
                  background: highlightStyle === s ? 'var(--accent-dark)' : 'var(--bg-elevated)',
                  color: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: '0.85em',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}>{s}</button>
            ))}
          </div>
        </Control>
        <Control label={`Position · ${fmtTime(position)} / ${fmtTime(duration)} (m. ${measureNow + 1}, beat ${beatNow.toFixed(1)})`}>
          <input type="range" min="0" max="1" step="0.001"
            value={duration > 0 ? position / duration : 0}
            onChange={(e) => seekToBeat(parseFloat(e.target.value))}
            style={{ width: '100%' }} />
        </Control>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
        <button onClick={() => setPlaying((p) => !p)} style={btn(playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => { setPlaying(false); setPosition(0); }} style={btn(false)}>Reset</button>
        <span style={{ alignSelf: 'center', color: 'var(--text-secondary)', fontSize: '0.8em' }}>
          virtual playhead · {timeline.length} cursor positions parsed
        </span>
      </div>

      <OsmdRenderer
        url={url}
        height={420}
        showCursor
        onReady={handleReady}
        onTimeline={handleTimeline}
      />
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      {children}
    </label>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '0.35rem 0.9rem',
    background: active ? 'var(--accent)' : 'var(--bg-elevated)',
    color: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: '0.9em',
  };
}

/**
 * Binary search — given a beat (quarter notes from start), find the cursor
 * index whose absoluteBeat is the largest <= beat.
 */
function findCursorIndexForBeat(beat: number, timeline: BeatStamp[]): number {
  if (timeline.length === 0) return 0;
  let lo = 0, hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (timeline[mid].absoluteBeat <= beat) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Mutate the OSMD-rendered SVG to express different "what's playing now"
 * highlight styles on the cursor element. OSMD draws the cursor as an
 * `<img>` overlay; we wrap it with classes / inline styles per option.
 */
function applyHighlight(osmd: any, style: HighlightStyle): void {
  const el = osmd?.cursor?.cursorElement as HTMLElement | undefined;
  if (!el) return;
  el.style.display = style === 'none' ? 'none' : '';
  switch (style) {
    case 'bbox':
      el.style.background = 'rgba(123,104,238,0.25)';
      el.style.borderLeft = '2px solid var(--accent, #7B68EE)';
      el.style.borderRight = '0';
      el.style.borderRadius = '2px';
      break;
    case 'underline':
      el.style.background = 'transparent';
      el.style.borderLeft = '0';
      el.style.borderBottom = '3px solid var(--accent-warm, #D4A843)';
      break;
    case 'color':
      el.style.background = 'rgba(212,168,67,0.18)';
      el.style.borderLeft = '0';
      break;
    default:
      break;
  }
}
