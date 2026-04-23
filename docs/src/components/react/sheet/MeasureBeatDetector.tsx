import { useCallback, useState } from 'react';
import { InfiniteScrollRenderer, type InfiniteBeatStamp } from './InfiniteScrollRenderer';
import { cardStyle, Toolbar, btn } from './InfiniteHorizontalDemo';

interface Props {
  scoreUrl: string;
}

/**
 * Widget 1½ — "what does the code think is where?"
 *
 * Renders the score and overlays two sets of vertical lines on top:
 *
 *   - **measure lines** (magenta): from `onMeasureXs` — barline candidates
 *     detected by scanning the rendered SVG for tall, narrow vertical
 *     elements (lines / paths / rects) and clustering by x
 *   - **beat lines** (yellow): from the cursor timeline — one per
 *     `osmd.cursor.next()` step (note/chord/rest onset)
 *
 * Lines live inside the scroll host as an overlay, so they scroll natively
 * with the score. If a magenta line doesn't sit on an actual barline, the
 * SVG scan's geometry filter is wrong. If a yellow line doesn't sit on a
 * notehead, the cursor offset math is wrong.
 */
export function MeasureBeatDetector({ scoreUrl }: Props) {
  const [timeline, setTimeline] = useState<InfiniteBeatStamp[]>([]);
  const [measureXs, setMeasureXs] = useState<number[]>([]);
  const [showMeasures, setShowMeasures] = useState(true);
  const [showBeats, setShowBeats] = useState(true);
  const [showDownbeatsOnly, setShowDownbeatsOnly] = useState(false);
  const [nudgePx, setNudgePx] = useState(0);

  const handleTimeline = useCallback((tl: InfiniteBeatStamp[]) => setTimeline(tl), []);
  const handleMeasureXs = useCallback((xs: number[]) => setMeasureXs(xs), []);

  const visibleBeats = showDownbeatsOnly
    ? timeline.filter((s) => s.beatInMeasure < 0.01)
    : timeline;

  const lines = (
    <>
      {showMeasures && measureXs.map((x, i) => (
        <Line key={`m${i}`} x={x + nudgePx} color="rgba(236,72,153,0.85)" width={1.5}
          label={`m${i + 1}`} labelTop />
      ))}
      {showBeats && visibleBeats.map((s) => (
        <Line key={`b${s.index}`} x={s.xPx} color="rgba(250,204,21,0.55)" width={1}
          label={s.beatInMeasure < 0.01 ? `${s.measureIndex + 1}.1` : undefined}
          labelBottom />
      ))}
    </>
  );

  return (
    <div style={cardStyle}>
      <Toolbar>
        <button onClick={() => setShowMeasures((v) => !v)} style={btn(showMeasures)}>
          <span style={{ color: 'rgb(236,72,153)' }}>●</span> measures ({measureXs.length})
        </button>
        <button onClick={() => setShowBeats((v) => !v)} style={btn(showBeats)}>
          <span style={{ color: 'rgb(250,204,21)' }}>●</span> beats ({timeline.length})
        </button>
        <button onClick={() => setShowDownbeatsOnly((v) => !v)} style={btn(showDownbeatsOnly)}>
          downbeats only
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8em', color: 'var(--text-secondary)' }}>
          measure nudge: {nudgePx >= 0 ? '+' : ''}{nudgePx}px
          <input
            type="range"
            min={-40}
            max={40}
            step={1}
            value={nudgePx}
            onChange={(e) => setNudgePx(parseInt(e.target.value, 10))}
            style={{ width: 140 }}
          />
          <button onClick={() => setNudgePx(0)} style={{ ...btn(false), padding: '0.15rem 0.5rem', fontSize: '0.75em' }}>0</button>
        </label>
      </Toolbar>

      <InfiniteScrollRenderer
        url={scoreUrl}
        height={210}
        zoom={0.9}
        onTimeline={handleTimeline}
        onMeasureXs={handleMeasureXs}
        overlay={lines}
      />

      <div style={{ marginTop: 8, fontSize: '0.72em', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        <div>
          <strong>magenta</strong> = measure-start x's derived from the cursor timeline: for each measure M, a 30 / 70 weighted midpoint between the last onset of measure M−1 and the first onset of M. Approximates the barline position; fine-tune with the nudge slider.
        </div>
        <div>
          <strong>yellow</strong> = cursor x's from <code>cursor.cursorElement.getBoundingClientRect()</code> at each step (one per onset). Filter to "downbeats only" to see the first onset of every measure.
        </div>
        <div>
          The SVG-scan approach didn't work because OSMD/VexFlow renders staff lines and barlines as composite <code>&lt;path&gt;</code> elements — individual barlines aren't addressable as their own DOM nodes.
        </div>
      </div>
    </div>
  );
}

function Line({
  x, color, width, label, labelTop, labelBottom,
}: {
  x: number;
  color: string;
  width: number;
  label?: string;
  labelTop?: boolean;
  labelBottom?: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        height: 210,
        left: x,
        width,
        background: color,
        pointerEvents: 'none',
      }}
    >
      {label && (
        <span
          style={{
            position: 'absolute',
            top: labelTop ? -14 : labelBottom ? 194 : 0,
            left: 2,
            fontSize: '9px',
            lineHeight: 1,
            color,
            fontFamily: 'var(--font-mono, monospace)',
            whiteSpace: 'nowrap',
            background: 'rgba(0,0,0,0.55)',
            padding: '1px 3px',
            borderRadius: 2,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
