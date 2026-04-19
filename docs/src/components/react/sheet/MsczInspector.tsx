import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';

interface FileEntry {
  name: string;
  size: number;
  isDir: boolean;
}

interface InspectorState {
  loading: boolean;
  error: string | null;
  entries: FileEntry[];
  zip: JSZip | null;
}

interface Props {
  /** URL of a zip-based score (.mscz or .mxl) */
  url: string;
  /** Friendly label shown in the header */
  label: string;
  /** Default file to show in the preview pane */
  defaultPath?: string;
  /** Cap shown bytes — these XML files are huge */
  previewBytes?: number;
}

export function MsczInspector({ url, label, defaultPath, previewBytes = 4000 }: Props) {
  const [state, setState] = useState<InspectorState>({
    loading: true,
    error: null,
    entries: [],
    zip: null,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Fetch + unzip
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch ${res.status}`);
        const buf = await res.arrayBuffer();
        const zip = await JSZip.loadAsync(buf);
        const entries: FileEntry[] = [];
        zip.forEach((path, file) => {
          entries.push({
            name: path,
            // @ts-expect-error JSZip's typings hide _data
            size: file._data?.uncompressedSize ?? 0,
            isDir: file.dir,
          });
        });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        if (cancelled) return;
        setState({ loading: false, error: null, entries, zip });
        const initial = defaultPath && entries.some((e) => e.name === defaultPath)
          ? defaultPath
          : entries.find((e) => e.name.endsWith('.xml') || e.name.endsWith('.mscx'))?.name ?? null;
        setSelected(initial);
      } catch (err) {
        if (cancelled) return;
        setState({ loading: false, error: String(err), entries: [], zip: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, defaultPath]);

  // Load selected file preview
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!state.zip || !selected) {
        setPreview('');
        return;
      }
      setPreviewLoading(true);
      const file = state.zip.file(selected);
      if (!file) {
        setPreview('');
        setPreviewLoading(false);
        return;
      }
      try {
        if (selected.endsWith('.png') || selected.endsWith('.jpg')) {
          const blob = await file.async('blob');
          if (cancelled) return;
          const dataUrl = URL.createObjectURL(blob);
          setPreview(`__IMAGE__:${dataUrl}`);
        } else {
          const text = await file.async('string');
          if (cancelled) return;
          setPreview(text);
        }
      } catch (err) {
        if (!cancelled) setPreview(`(unreadable: ${err})`);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, state.zip]);

  const totalBytes = useMemo(
    () => state.entries.reduce((sum, e) => sum + e.size, 0),
    [state.entries],
  );

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
      margin: '1.5rem 0',
    }}>
      <div style={{
        padding: '0.6rem 0.9rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface-tint)',
        display: 'flex',
        gap: '0.6rem',
        alignItems: 'baseline',
        flexWrap: 'wrap',
      }}>
        <strong style={{ color: 'var(--accent)' }}>{label}</strong>
        <code style={{ fontSize: '0.75em' }}>{url}</code>
        {!state.loading && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '0.85em' }}>
            {state.entries.length} files · {(totalBytes / 1024).toFixed(1)} KiB uncompressed
          </span>
        )}
      </div>

      {state.loading && <div style={{ padding: '1rem' }}>Loading…</div>}
      {state.error && <div style={{ padding: '1rem', color: '#f87171' }}>Error: {state.error}</div>}

      {!state.loading && !state.error && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 320 }}>
          <div style={{
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            overflow: 'auto',
            maxHeight: 480,
          }}>
            {state.entries.map((entry) => {
              const indent = (entry.name.match(/\//g) || []).length;
              const last = entry.name.split('/').filter(Boolean).pop() || entry.name;
              const active = selected === entry.name;
              return (
                <button
                  key={entry.name}
                  onClick={() => setSelected(entry.name)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.3rem 0.6rem',
                    paddingLeft: 0.6 + indent * 0.8 + 'rem',
                    background: active ? 'var(--accent-dark)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-primary)',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: '0.8em',
                    fontFamily: 'ui-monospace, monospace',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.isDir ? '▾ ' : '  '}{last || entry.name}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em' }}>
                    {entry.size > 0 ? formatSize(entry.size) : ''}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{
            padding: '0.6rem 0.9rem',
            overflow: 'auto',
            maxHeight: 480,
            background: 'var(--bg-secondary)',
          }}>
            {previewLoading && <div>Reading…</div>}
            {!previewLoading && preview.startsWith('__IMAGE__:') && (
              <img src={preview.replace('__IMAGE__:', '')} alt={selected || ''} style={{ maxWidth: '100%' }} />
            )}
            {!previewLoading && !preview.startsWith('__IMAGE__:') && selected && (
              <>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8em', marginBottom: '0.4rem' }}>
                  {selected} · showing first {previewBytes.toLocaleString()} bytes of {preview.length.toLocaleString()}
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: '0.78em',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: 'var(--bg-primary)',
                  padding: '0.6rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  maxHeight: 380,
                  overflow: 'auto',
                }}>
                  {preview.slice(0, previewBytes)}{preview.length > previewBytes ? '\n…' : ''}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
