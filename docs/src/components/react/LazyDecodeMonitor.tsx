import { useState, useRef, useCallback, useEffect } from 'react';

const SAMPLES = [
  'drum-sample.opus', 'horn-sample.opus', 'vox-sample.opus',
  'drum-sample.mp3', 'horn-sample.mp3', 'vox-sample.mp3',
  'drum-sample.flac', 'horn-sample.flac', 'vox-sample.flac',
];

interface StemEntry {
  name: string;
  arrayBuffer: ArrayBuffer;
  status: 'pending' | 'decoding' | 'decoded';
  pcmBytes: number | null;
  channels: number | null;
  sampleRate: number | null;
  duration: number | null;
  decodeMs: number | null;
}

function fmt(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function decodeEntry(ctx: AudioContext, s: StemEntry): Promise<StemEntry> {
  const start = performance.now();
  const buf = await ctx.decodeAudioData(s.arrayBuffer.slice(0));
  const elapsed = Math.round(performance.now() - start);
  const pcmBytes = buf.length * buf.numberOfChannels * 4;
  return {
    ...s,
    status: 'decoded',
    pcmBytes,
    channels: buf.numberOfChannels,
    sampleRate: buf.sampleRate,
    duration: buf.duration,
    decodeMs: elapsed,
  };
}

export function LazyDecodeMonitor() {
  const [stems, setStems] = useState<StemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  };

  // Fetch all samples on mount, start as pending
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      SAMPLES.map(async (name) => {
        const resp = await fetch(`/audio-samples/${name}`);
        if (!resp.ok) return null;
        const arrayBuffer = await resp.arrayBuffer();
        return {
          name,
          arrayBuffer,
          status: 'pending' as const,
          pcmBytes: null,
          channels: null,
          sampleRate: null,
          duration: null,
          decodeMs: null,
        };
      }),
    ).then((results) => {
      if (!cancelled) {
        setStems(results.filter((r): r is StemEntry => r !== null));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const decodeAll = useCallback(async () => {
    const ctx = getCtx();
    for (let i = 0; i < stems.length; i++) {
      if (stems[i].status !== 'pending') continue;
      setStems(prev => prev.map((s, j) => j === i ? { ...s, status: 'decoding' } : s));
      const decoded = await decodeEntry(ctx, stems[i]);
      setStems(prev => prev.map((s, j) => j === i ? decoded : s));
    }
  }, [stems]);

  const decodeSingle = useCallback(async (idx: number) => {
    const ctx = getCtx();
    const entry = stems[idx];
    if (!entry || entry.status !== 'pending') return;
    setStems(prev => prev.map((s, i) => i === idx ? { ...s, status: 'decoding' } : s));
    const decoded = await decodeEntry(ctx, entry);
    setStems(prev => prev.map((s, i) => i === idx ? decoded : s));
  }, [stems]);

  const decodedCount = stems.filter(s => s.status === 'decoded').length;
  const pendingCount = stems.filter(s => s.status === 'pending').length;
  const decodedBytes = stems.reduce((sum, s) => sum + (s.pcmBytes ?? 0), 0);

  const s = {
    container: {
      background: '#1a1a2e',
      borderRadius: '12px',
      border: '1px solid #2A2A2C',
      padding: '1.25rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '540px',
      margin: '0 auto',
    },
    summary: {
      display: 'flex',
      gap: '1rem',
      marginBottom: '0.75rem',
      fontSize: '0.8rem',
    },
    stat: {
      padding: '0.4rem 0.6rem',
      borderRadius: '6px',
      background: '#222',
      flex: 1,
      textAlign: 'center' as const,
    },
    statLabel: { color: '#808080', fontSize: '0.7rem' },
    statValue: { color: '#E0DED8', fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 600 },
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.35rem 0',
      borderBottom: '1px solid #222',
      fontSize: '0.78rem',
    },
    name: { flex: 1, color: '#E0DED8', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const },
    badge: (status: StemEntry['status']) => ({
      padding: '0.15rem 0.4rem',
      borderRadius: '4px',
      fontSize: '0.68rem',
      fontWeight: 600,
      background: status === 'decoded' ? 'rgba(74, 222, 128, 0.15)' : status === 'decoding' ? 'rgba(250, 204, 21, 0.15)' : 'rgba(212, 168, 67, 0.15)',
      color: status === 'decoded' ? '#4ade80' : status === 'decoding' ? '#facc15' : '#D4A843',
      flexShrink: 0,
    }),
    detail: { color: '#808080', fontFamily: 'monospace', fontSize: '0.72rem', flexShrink: 0 },
    btn: (small?: boolean) => ({
      padding: small ? '0.15rem 0.4rem' : '0.5rem 0.75rem',
      border: 'none',
      borderRadius: '6px',
      background: '#7B68EE',
      color: '#fff',
      cursor: 'pointer',
      fontSize: small ? '0.7rem' : '0.82rem',
      fontWeight: 500,
      flexShrink: 0,
    }),
    loading: {
      fontSize: '0.85rem',
      color: '#808080',
      textAlign: 'center' as const,
      padding: '1rem 0',
    },
  };

  return (
    <div style={s.container}>
      {loading ? (
        <div style={s.loading}>Fetching samples...</div>
      ) : stems.length === 0 ? (
        <div style={s.loading}>No samples found</div>
      ) : (
        <>
          <div style={s.summary}>
            <div style={s.stat}>
              <div style={s.statLabel}>decoded</div>
              <div style={s.statValue}>{decodedCount}</div>
            </div>
            <div style={s.stat}>
              <div style={s.statLabel}>pending</div>
              <div style={s.statValue}>{pendingCount}</div>
            </div>
            <div style={s.stat}>
              <div style={s.statLabel}>PCM memory</div>
              <div style={s.statValue}>{fmt(decodedBytes)}</div>
            </div>
          </div>

          {pendingCount > 0 && (
            <div style={{ marginBottom: '0.5rem' }}>
              <button style={s.btn()} onClick={decodeAll}>Decode all pending</button>
            </div>
          )}

          {stems.map((stem, i) => (
            <div key={i} style={s.row}>
              <span style={s.name}>{stem.name}</span>
              <span style={s.badge(stem.status)}>
                {stem.status}
              </span>
              {stem.status === 'decoded' ? (
                <span style={s.detail}>
                  {stem.channels}ch {fmt(stem.pcmBytes!)} {stem.decodeMs}ms
                </span>
              ) : stem.status === 'pending' ? (
                <button style={s.btn(true)} onClick={() => decodeSingle(i)}>decode</button>
              ) : null}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
