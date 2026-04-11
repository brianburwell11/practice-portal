import { useState, useRef, useEffect, useCallback } from 'react';
import { TouchSlider } from '@app/components/ui/TouchSlider';

type Format = 'opus' | 'mp3' | 'flac';
type Sample = 'drum-sample' | 'horn-sample' | 'vox-sample';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const FORMATS: { key: Format; label: string; sublabel: string }[] = [
  { key: 'opus', label: 'Opus', sublabel: '128 kbps' },
  { key: 'mp3', label: 'MP3', sublabel: '192 kbps' },
  { key: 'flac', label: 'FLAC', sublabel: 'lossless' },
];

const SAMPLES: { key: Sample; label: string }[] = [
  { key: 'drum-sample', label: 'Drums' },
  { key: 'horn-sample', label: 'Horn' },
  { key: 'vox-sample', label: 'Vocals' },
];

const SPEED_MIN = 0.25;
const SPEED_MAX = 1.5;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getListeningTip(speed: number): string {
  if (speed >= 0.85)
    return 'At normal speed, all three formats sound nearly identical. Try slowing down below 0.7x to hear the differences.';
  if (speed >= 0.6)
    return 'At this speed, listen for a slight "swooshing" quality on drum hits and note attacks in MP3. Opus and FLAC should sound cleaner.';
  return 'At very slow speeds, MP3\'s pre-echo artifacts are clearly audible as metallic shimmer around transients. Compare with FLAC (clean) and Opus (minimal artifacts).';
}

export function AudioFormatExplorer({ basePath = '/audio-samples' }: { basePath?: string }) {
  const [sample, setSample] = useState<Sample>('drum-sample');
  const [format, setFormat] = useState<Format>('flac');
  const [speed, setSpeed] = useState(1.0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [supported, setSupported] = useState<Record<Format, boolean>>({ opus: true, mp3: true, flac: true });
  const [speedNote, setSpeedNote] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const genRef = useRef(0); // generation counter for rapid switching
  const seekOnLoadRef = useRef<number | null>(null);
  const playOnLoadRef = useRef(false);

  // Detect format support on mount
  useEffect(() => {
    const a = new Audio();
    setSupported({
      opus: a.canPlayType('audio/ogg; codecs=opus') !== '' || a.canPlayType('audio/webm; codecs=opus') !== '',
      mp3: a.canPlayType('audio/mpeg') !== '',
      flac: a.canPlayType('audio/flac') !== '',
    });
  }, []);

  // rAF loop for position updates
  const startRAF = useCallback(() => {
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRAF = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Create/swap audio element when format changes
  useEffect(() => {
    const gen = ++genRef.current;

    // Tear down previous
    if (audioRef.current) {
      seekOnLoadRef.current = audioRef.current.currentTime;
      playOnLoadRef.current = playing;
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
    stopRAF();

    setLoadState('loading');

    const audio = new Audio(`${basePath}/${sample}.${format}`);
    audio.playbackRate = speed;
    audioRef.current = audio;

    const onMeta = () => {
      if (gen !== genRef.current) return; // stale
      setDuration(audio.duration);
      setLoadState('ready');

      // Restore position
      if (seekOnLoadRef.current !== null && isFinite(seekOnLoadRef.current)) {
        audio.currentTime = Math.min(seekOnLoadRef.current, audio.duration);
        seekOnLoadRef.current = null;
      }

      // Resume playback if was playing
      if (playOnLoadRef.current) {
        audio.play().catch(() => {});
        startRAF();
        playOnLoadRef.current = false;
      }
    };

    const onEnded = () => {
      if (gen !== genRef.current) return;
      setPlaying(false);
      stopRAF();
      setCurrentTime(0);
    };

    const onError = () => {
      if (gen !== genRef.current) return;
      setLoadState('error');
      setPlaying(false);
      stopRAF();
    };

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.pause();
      stopRAF();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, sample, basePath]);

  // Apply speed changes to current audio
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = speed;

    // Check if browser clamped the value
    const actual = audioRef.current.playbackRate;
    if (Math.abs(actual - speed) > 0.01) {
      setSpeedNote(`Your browser limits playback speed to ${Math.round(actual * 100)}% minimum.`);
    } else {
      setSpeedNote(null);
    }
  }, [speed]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || loadState !== 'ready') return;

    if (playing) {
      audio.pause();
      stopRAF();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      startRAF();
      setPlaying(true);
    }
  }, [playing, loadState, startRAF, stopRAF]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !isFinite(duration) || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const switchFormat = useCallback((f: Format) => {
    if (f === format || !supported[f]) return;
    setFormat(f);
  }, [format, supported]);

  const switchSample = useCallback((s: Sample) => {
    if (s === sample) return;
    seekOnLoadRef.current = null;
    playOnLoadRef.current = false;
    setPlaying(false);
    setSample(s);
  }, [sample]);

  // Styles
  const s = {
    container: {
      background: '#1a1a2e',
      borderRadius: '12px',
      border: '1px solid #2A2A2C',
      padding: '1.25rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '480px',
      margin: '0 auto',
    } as const,
    section: {
      padding: '0.75rem 0',
      borderBottom: '1px solid #2A2A2C',
    } as const,
    sectionLast: {
      padding: '0.75rem 0',
    } as const,
    formatRow: {
      display: 'flex',
      gap: '0.5rem',
    } as const,
    formatBtn: (active: boolean, disabled: boolean) => ({
      flex: 1,
      padding: '0.5rem 0.25rem',
      border: `1px solid ${active ? '#7B68EE' : '#2A2A2C'}`,
      borderRadius: '8px',
      background: active ? 'rgba(123, 104, 238, 0.15)' : 'transparent',
      color: disabled ? '#555' : active ? '#E0DED8' : '#808080',
      cursor: disabled ? 'not-allowed' : 'pointer',
      textAlign: 'center' as const,
      transition: 'all 0.15s',
      opacity: disabled ? 0.5 : 1,
    }),
    sampleRow: {
      display: 'flex',
      gap: '0.5rem',
      marginBottom: '0.5rem',
    } as const,
    sampleBtn: (active: boolean) => ({
      flex: 1,
      padding: '0.35rem 0.25rem',
      border: `1px solid ${active ? '#7B68EE' : '#2A2A2C'}`,
      borderRadius: '6px',
      background: active ? 'rgba(123, 104, 238, 0.15)' : 'transparent',
      color: active ? '#E0DED8' : '#808080',
      cursor: 'pointer',
      textAlign: 'center' as const,
      fontSize: '0.8rem',
      fontWeight: active ? 600 : 400,
      transition: 'all 0.15s',
    }),
    formatLabel: {
      fontSize: '0.9rem',
      fontWeight: 600,
    } as const,
    formatSub: {
      fontSize: '0.7rem',
      color: '#808080',
      marginTop: '2px',
    } as const,
    transportRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
    } as const,
    playBtn: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: '1px solid #2A2A2C',
      background: '#7B68EE',
      color: '#fff',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      fontSize: '1rem',
    } as const,
    time: {
      fontSize: '0.75rem',
      color: '#808080',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap' as const,
      flexShrink: 0,
    },
    progressOuter: {
      flex: 1,
      height: '6px',
      background: '#2A2A2C',
      borderRadius: '3px',
      cursor: 'pointer',
      position: 'relative' as const,
    },
    progressFill: (pct: number) => ({
      position: 'absolute' as const,
      left: 0,
      top: 0,
      height: '100%',
      width: `${pct}%`,
      background: '#7B68EE',
      borderRadius: '3px',
      transition: 'width 0.05s linear',
    }),
    speedRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
    } as const,
    speedLabel: {
      fontSize: '0.75rem',
      color: '#808080',
      whiteSpace: 'nowrap' as const,
    },
    speedValue: {
      fontSize: '0.75rem',
      color: '#E0DED8',
      fontFamily: 'monospace',
      width: '2.5rem',
      textAlign: 'right' as const,
    },
    tip: {
      fontSize: '0.8rem',
      color: '#808080',
      lineHeight: 1.5,
    } as const,
    note: {
      fontSize: '0.75rem',
      color: '#D4A843',
      marginTop: '0.25rem',
    } as const,
    statusMsg: {
      fontSize: '0.8rem',
      color: '#808080',
      textAlign: 'center' as const,
      padding: '0.5rem 0',
    },
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={s.container}>
      {/* Sample + Format selector */}
      <div style={s.section}>
        <div style={s.sampleRow}>
          {SAMPLES.map((sm) => (
            <button
              key={sm.key}
              onClick={() => switchSample(sm.key)}
              style={s.sampleBtn(sample === sm.key)}
            >
              {sm.label}
            </button>
          ))}
        </div>
        <div style={s.formatRow}>
          {FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => switchFormat(f.key)}
              style={s.formatBtn(format === f.key, !supported[f.key])}
              disabled={!supported[f.key]}
              title={!supported[f.key] ? `${f.label} not supported in this browser` : undefined}
            >
              <div style={s.formatLabel}>{f.label}</div>
              <div style={s.formatSub}>
                {!supported[f.key] ? 'unsupported' : f.sublabel}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transport */}
      <div style={s.section}>
        {loadState === 'error' ? (
          <div style={s.statusMsg}>
            Failed to load {format.toUpperCase()} sample. Place audio files in <code>/audio-samples/</code>.
          </div>
        ) : (
          <div style={s.transportRow}>
            <button
              onClick={togglePlay}
              style={s.playBtn}
              disabled={loadState !== 'ready'}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <div style={s.progressOuter} onClick={seek}>
              <div style={s.progressFill(progressPct)} />
            </div>
            <span style={s.time}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        )}
      </div>

      {/* Speed slider */}
      <div style={s.section}>
        <div style={s.speedRow}>
          <span style={s.speedLabel}>Speed</span>
          <div style={{ flex: 1 }}>
            <TouchSlider
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={0.05}
              value={speed}
              onChange={setSpeed}
              onDoubleClick={() => setSpeed(1.0)}
              label="Playback speed"
            />
          </div>
          <span style={s.speedValue}>{Math.round(speed * 100)}%</span>
        </div>
        {speedNote && <div style={s.note}>{speedNote}</div>}
      </div>

      {/* Listening tip */}
      <div style={s.sectionLast}>
        <div style={s.tip}>{getListeningTip(speed)}</div>
      </div>
    </div>
  );
}
