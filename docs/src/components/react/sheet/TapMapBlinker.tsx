import { useEffect, useMemo, useState } from 'react';
import { useAudioPlayhead } from './useAudioPlayhead';
import type { WiggleConfig, WiggleTap } from './wiggleSync';
import { Toolbar, btn, meta, fmt } from './InfiniteHorizontalDemo';
import { useTapMapOffset } from './tapMapOffsetStore';

interface Props {
  /**
   * Optional default audio. The widget also lets the reader switch between
   * available stems to see which one the tapMap was tapped against.
   */
  audioUrl?: string;
  configUrl: string;
}

interface StemOption {
  label: string;
  url: string;
}

const DEFAULT_STEMS: StemOption[] = [
  { label: 'SOOZA mix', url: '/xml-sample/sooza-brass-band_songs_wiggle-sooza_Sooza.mp3' },
  { label: 'DRM', url: '/xml-sample/sooza-brass-band_songs_wiggle-sooza_DRM.mp3' },
  { label: 'Trumpet 1', url: '/xml-sample/sooza-brass-band_songs_wiggle-sooza_Trumpet%201.mp3' },
];

/**
 * Widget 0 — TapMap sync check.
 *
 * No score rendering, no tempo math, no MusicXML. Just a small light that
 * flashes when `audio.currentTime` crosses a `measure` or `section` entry in
 * the tapMap JSON. This is the ground-truth sync check — if the light doesn't
 * match what you hear, every downstream widget is drawing off bad data.
 *
 * The light's firing times are exactly `tap.time` (seconds). No fallback BPM,
 * no interpolation, no MusicXML-tempo involvement anywhere.
 */
export function TapMapBlinker({ audioUrl, configUrl }: Props) {
  const [config, setConfig] = useState<WiggleConfig | null>(null);
  const [stemUrl, setStemUrl] = useState<string>(audioUrl ?? DEFAULT_STEMS[0].url);
  const [offsetSec, setOffsetSec] = useTapMapOffset();
  const { audioRef, currentTime, duration, playing, toggle, seek } = useAudioPlayhead(stemUrl);

  useEffect(() => {
    let cancelled = false;
    fetch(configUrl)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setConfig(j); })
      .catch((e) => console.error('config load', e));
    return () => { cancelled = true; };
  }, [configUrl]);

  const markers = useMemo<WiggleTap[]>(() => {
    if (!config) return [];
    return config.tapMap.filter((t) => t.type === 'measure' || t.type === 'section');
  }, [config]);

  const FLASH_MS = 200;

  // `effective` = audio time shifted by the nudge. Positive nudge means
  // "the tapMap was tapped N seconds late; pretend the audio is N seconds
  // ahead of where it actually is" → markers fire earlier.
  const effective = currentTime + offsetSec;

  const lastMarkerIdx = useMemo(() => {
    if (markers.length === 0) return -1;
    let lo = 0;
    let hi = markers.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (markers[mid].time <= effective) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [effective, markers]);

  const lastMarker = lastMarkerIdx >= 0 ? markers[lastMarkerIdx] : null;
  const nextMarker = lastMarkerIdx + 1 < markers.length ? markers[lastMarkerIdx + 1] : null;

  const brightness = lastMarker
    ? Math.max(0, 1 - ((effective - lastMarker.time) * 1000) / FLASH_MS)
    : 0;

  const isSection = lastMarker?.type === 'section';
  const { r, g, b } = isSection ? { r: 245, g: 158, b: 11 } : { r: 34, g: 211, b: 238 };

  return (
    <div style={cardStyleNarrow}>
      <Toolbar>
        <button onClick={toggle} style={btn(playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => seek(0)} style={btn(false)}>Reset</button>
        <select
          value={stemUrl}
          onChange={(e) => setStemUrl(e.target.value)}
          style={selectStyle}
        >
          {DEFAULT_STEMS.map((s) => (
            <option key={s.url} value={s.url}>{s.label}</option>
          ))}
        </select>
        <span style={meta}>{fmt(currentTime)} / {fmt(duration)}</span>
      </Toolbar>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.4rem 0' }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            flexShrink: 0,
            background: `rgba(${r}, ${g}, ${b}, ${0.08 + brightness * 0.85})`,
            boxShadow: brightness > 0.05
              ? `0 0 ${12 + brightness * 32}px ${brightness * 8}px rgba(${r}, ${g}, ${b}, ${brightness * 0.75})`
              : `inset 0 0 10px rgba(0,0,0,0.45)`,
            border: `2px solid rgba(${r}, ${g}, ${b}, ${0.25 + brightness * 0.75})`,
            transition: brightness > 0.9 ? 'none' : 'background 40ms linear, box-shadow 40ms linear',
          }}
          aria-label={isSection ? 'Section flash' : 'Measure flash'}
        />
        <div style={{ fontSize: '0.78em', lineHeight: 1.55, fontVariantNumeric: 'tabular-nums' }}>
          <div>
            {lastMarker
              ? <><span style={{ color: isSection ? 'rgb(245,158,11)' : 'rgb(34,211,238)' }}>{lastMarker.type}</span> @ {lastMarker.time.toFixed(3)}s · {(effective - lastMarker.time).toFixed(2)}s ago</>
              : <span style={{ color: 'var(--text-secondary)' }}>— pre-roll —</span>}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {nextMarker ? <>next {nextMarker.type} in {(nextMarker.time - effective).toFixed(2)}s</> : 'end'}
            {' · '}{lastMarkerIdx + 1}/{markers.length}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <label style={{ fontSize: '0.75em', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          nudge: {offsetSec >= 0 ? '+' : ''}{offsetSec.toFixed(2)}s
        </label>
        <input
          type="range"
          min={-3}
          max={3}
          step={0.01}
          value={offsetSec}
          onChange={(e) => setOffsetSec(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
        <button onClick={() => setOffsetSec(0)} style={{ ...btn(false), padding: '0.2rem 0.6rem', fontSize: '0.75em' }}>0</button>
      </div>

      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.05}
        value={currentTime}
        onChange={(e) => seek(parseFloat(e.target.value))}
        style={{ width: '100%', marginTop: 4 }}
      />
      <audio ref={audioRef} preload="metadata" src={stemUrl} style={{ display: 'none' }} />

      <div style={{ marginTop: 8, fontSize: '0.7em', color: 'var(--text-secondary)' }}>
        {markers.length} markers. Fires purely on <code>tap.time</code> — no BPM, no tempoMap, no MusicXML tempo. If the flashes feel off, adjust the nudge until they lock; positive = tapMap was tapped late, negative = tapped early. The nudge applies to every widget below too.
      </div>
    </div>
  );
}

// Narrow variant of the shared card — stays inside the 820px prose column.
const cardStyleNarrow: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg-secondary)',
  padding: '0.7rem',
  margin: '1.5rem auto',
  maxWidth: 520,
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  padding: '0.3rem 0.5rem',
  background: 'var(--bg-elevated)',
  color: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: '0.85em',
  cursor: 'pointer',
};
