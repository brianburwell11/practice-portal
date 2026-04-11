import { useState, useRef, useCallback } from 'react';

interface StemEntry {
  name: string;
  arrayBuffer: ArrayBuffer;
  status: 'pending' | 'decoded';
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

export function LazyDecodeMonitor() {
  const [stems, setStems] = useState<StemEntry[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  };

  const loadFiles = useCallback(async (files: FileList | File[]) => {
    const entries: StemEntry[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.wav', '.mp3', '.ogg', '.opus', '.flac', '.aiff', '.aif', '.m4a'].includes(ext)) continue;
      const ab = await file.arrayBuffer();
      entries.push({
        name: file.name,
        arrayBuffer: ab,
        status: 'pending',
        pcmBytes: null,
        channels: null,
        sampleRate: null,
        duration: null,
        decodeMs: null,
      });
    }
    setStems(entries);
  }, []);

  const decodeAll = useCallback(async () => {
    const ctx = getCtx();
    setStems(prev => prev.map(s => {
      if (s.status === 'decoded') return s;
      return decodeEntry(ctx, s);
    }));
    // Need to await all decodes
    const updated: StemEntry[] = [];
    for (const s of stems) {
      if (s.status === 'decoded') {
        updated.push(s);
      } else {
        updated.push(await decodeEntryAsync(ctx, s));
      }
    }
    setStems(updated);
  }, [stems]);

  const decodeSingle = useCallback(async (idx: number) => {
    const ctx = getCtx();
    const entry = stems[idx];
    if (!entry || entry.status === 'decoded') return;
    const decoded = await decodeEntryAsync(ctx, entry);
    setStems(prev => prev.map((s, i) => i === idx ? decoded : s));
  }, [stems]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  }, [loadFiles]);

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
    dropzone: {
      border: '2px dashed #2A2A2C',
      borderRadius: '8px',
      padding: '1.5rem',
      textAlign: 'center' as const,
      color: '#808080',
      fontSize: '0.85rem',
      cursor: 'pointer',
      marginBottom: '0.75rem',
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
    badge: (decoded: boolean) => ({
      padding: '0.15rem 0.4rem',
      borderRadius: '4px',
      fontSize: '0.68rem',
      fontWeight: 600,
      background: decoded ? 'rgba(74, 222, 128, 0.15)' : 'rgba(212, 168, 67, 0.15)',
      color: decoded ? '#4ade80' : '#D4A843',
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
  };

  return (
    <div style={s.container}>
      <div
        style={s.dropzone}
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = 'audio/*';
          input.onchange = () => { if (input.files) loadFiles(input.files); };
          input.click();
        }}
      >
        Drop audio files here or tap to browse
      </div>

      {stems.length > 0 && (
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
              <span style={s.badge(stem.status === 'decoded')}>
                {stem.status === 'decoded' ? 'decoded' : 'pending'}
              </span>
              {stem.status === 'decoded' ? (
                <span style={s.detail}>
                  {stem.channels}ch {fmt(stem.pcmBytes!)} {stem.decodeMs}ms
                </span>
              ) : (
                <button style={s.btn(true)} onClick={() => decodeSingle(i)}>decode</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function decodeEntry(_ctx: AudioContext, s: StemEntry): StemEntry {
  return s; // placeholder for sync path
}

async function decodeEntryAsync(ctx: AudioContext, s: StemEntry): Promise<StemEntry> {
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
