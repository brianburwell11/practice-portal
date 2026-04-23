import { useEffect, useRef, useState } from 'react';

interface PartInfo {
  id: string;        // e.g. "P1"
  name: string;      // human-readable
  index: number;     // 0-based
}

interface Props {
  url: string;
  height?: number;
}

/**
 * Loads MusicXML once, parses out the part list, then re-renders OSMD with
 * the selected parts only by mutating the loaded score's `Instruments`
 * `Visible` flag. OSMD honors that on the next render() call without
 * re-parsing the source XML — much faster than a full reload.
 */
export function InstrumentSelector({ url, height = 460 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<any>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!containerRef.current) return;
        setStatus('loading');
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (cancelled) return;

        if (osmdRef.current) {
          try { osmdRef.current.clear(); } catch (_) { /* */ }
          osmdRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: false,
          backend: 'svg',
          drawTitle: true,
          drawPartNames: true,
          drawingParameters: 'compact',
        });
        const text = await fetch(url).then((r) => r.text());
        if (cancelled) return;
        await osmd.load(text);

        // Discover parts
        const instruments: any[] = osmd.Sheet?.Instruments ?? [];
        const partList: PartInfo[] = instruments.map((inst, i) => ({
          id: inst.IdString ?? `P${i + 1}`,
          name: inst.Name ?? inst.NameLabel?.text ?? `Part ${i + 1}`,
          index: i,
        }));
        const initialVisible = new Set(partList.map((p) => p.id));

        // First render: everything visible
        const t0 = performance.now();
        osmd.render();
        setRenderMs(performance.now() - t0);

        osmdRef.current = osmd;
        if (cancelled) return;
        setParts(partList);
        setVisible(initialVisible);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // Re-render when visibility changes
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== 'ready' || parts.length === 0) return;
    const instruments: any[] = osmd.Sheet?.Instruments ?? [];
    instruments.forEach((inst, i) => {
      const id = parts[i]?.id;
      const v = id ? visible.has(id) : true;
      inst.Visible = v;
    });
    const t0 = performance.now();
    try {
      osmd.render();
      setRenderMs(performance.now() - t0);
    } catch (err) {
      console.warn('re-render failed', err);
    }
  }, [visible, parts, status]);

  const toggle = (id: string) => {
    setVisible((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // OSMD requires at least one visible part — guard that.
      if (next.size === 0) next.add(id);
      return next;
    });
  };

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg-secondary)',
      padding: '0.6rem',
      margin: '1.5rem 0',
    }}>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.4rem',
        padding: '0.4rem 0.2rem 0.7rem',
        borderBottom: '1px solid var(--border)',
        marginBottom: '0.6rem',
        alignItems: 'center',
      }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85em', marginRight: '0.4rem' }}>
          Show parts:
        </span>
        {parts.map((p) => {
          const on = visible.has(p.id);
          return (
            <button key={p.id} onClick={() => toggle(p.id)} style={{
              padding: '0.3rem 0.6rem',
              background: on ? 'var(--accent-dark)' : 'var(--bg-elevated)',
              color: on ? '#fff' : 'var(--text-secondary)',
              border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
              borderRadius: 4,
              fontSize: '0.85em',
              cursor: 'pointer',
            }}>{p.name}</button>
          );
        })}
        {renderMs !== null && (
          <span style={{ marginLeft: 'auto', fontSize: '0.75em', color: 'var(--text-secondary)' }}>
            re-render {renderMs.toFixed(0)}ms
          </span>
        )}
      </div>
      <div style={{
        position: 'relative',
        height,
        overflow: 'auto',
        background: '#fff',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}>
        <div ref={containerRef} style={{ minHeight: height }} />
        {status !== 'ready' && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#888', background: 'rgba(255,255,255,0.6)',
          }}>
            {status === 'error' ? `Error: ${error}` : 'loading…'}
          </div>
        )}
      </div>
    </div>
  );
}
