import { useEffect, useRef, useState } from 'react';

interface Props {
  url: string;
  height?: number;
  /** Pixel width of one rendered page; controls layout density */
  pageWidth?: number;
}

/**
 * Verovio is a WASM-based engraver. The default `verovio` package exports a
 * UMD bundle with the WASM blob inlined as base64, so we don't need to host
 * any side files — just import and wait for `verovio.module` to resolve.
 */
export function VerovioRenderer({ url, height = 360, pageWidth = 1200 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        // Default export is `{ module, toolkit, ... }`. The Module is itself a
        // promise that resolves once the wasm runtime is ready.
        const verovioModule = await import('verovio');
        const verovio: any = (verovioModule as any).default ?? verovioModule;
        await verovio.module;
        if (cancelled) return;

        const tk = new verovio.toolkit();
        tk.setOptions({
          pageWidth,
          pageHeight: 600,
          scale: 40,
          adjustPageHeight: true,
          breaks: 'auto',
          spacingNonLinear: 0.6,
          spacingLinear: 0.25,
          inputFrom: 'musicxml',
        });

        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
          return r.text();
        });
        if (cancelled) return;

        setStatus('rendering');
        const t0 = performance.now();
        tk.loadData(text);
        const pc = tk.getPageCount();
        const svgs: string[] = [];
        // Cap pages to keep the demo light
        const maxPages = Math.min(pc, 4);
        for (let i = 1; i <= maxPages; i++) {
          svgs.push(tk.renderToSVG(i));
        }
        const dt = performance.now() - t0;
        if (cancelled) return;
        setRenderMs(dt);
        setPageCount(pc);
        setPages(svgs);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('Verovio render failed', err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [url, pageWidth]);

  return (
    <div>
      <div style={{
        position: 'relative',
        height,
        overflow: 'auto',
        background: '#fff',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}>
        <div
          ref={containerRef}
          dangerouslySetInnerHTML={{ __html: pages.join('') }}
          style={{ minHeight: height }}
        />
        {status !== 'ready' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            background: 'rgba(255,255,255,0.6)',
            textAlign: 'center',
            padding: '1rem',
          }}>
            {status === 'error' ? `Error: ${error}` : `${status}…`}
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
        Verovio · {status}{renderMs ? ` · render ${renderMs.toFixed(0)}ms` : ''}{pageCount ? ` · ${pages.length}/${pageCount} page${pageCount > 1 ? 's' : ''}` : ''}
      </div>
    </div>
  );
}
