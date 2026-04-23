import { useEffect, useRef, useState } from 'react';

interface Props {
  /** URL of a .musicxml file (we parse a small subset by hand) */
  url: string;
  height?: number;
  /** Number of measures to draw per system */
  measuresPerLine?: number;
  /** Cap the total measures rendered — VexFlow is hand-driven so this is slow */
  maxMeasures?: number;
}

interface ParsedNote {
  /** VexFlow key string e.g. "c/4", "f#/5", or "b/4" */
  keys: string[];
  /** VexFlow duration code: "w","h","q","8","16","32"; suffix "r" = rest */
  duration: string;
  /** Articulation hint for staccato/tenuto if present */
  articulation?: 'staccato' | 'tenuto';
}

interface ParsedMeasure {
  number: number;
  notes: ParsedNote[];
  /** divisions per quarter for this measure (carries forward) */
  divisions: number;
}

/**
 * VexFlow doesn't ingest MusicXML on its own. To make a fair comparison we
 * parse a small subset by hand for one part (the first <part>) and feed
 * VexFlow ParsedMeasures. This deliberately under-renders Wiggle to show
 * the cost of going low-level.
 */
export function VexFlowRenderer({
  url,
  height = 360,
  measuresPerLine = 4,
  maxMeasures = 16,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'parsing' | 'rendering' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [parseMs, setParseMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!containerRef.current) return;
        setStatus('loading');
        const text = await fetch(url).then((r) => {
          if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
          return r.text();
        });
        if (cancelled) return;

        setStatus('parsing');
        const t0 = performance.now();
        const measures = parseFirstPart(text, maxMeasures);
        setParseMs(performance.now() - t0);
        if (cancelled) return;

        const VF = await import('vexflow');
        if (cancelled) return;

        setStatus('rendering');
        const t1 = performance.now();
        containerRef.current.innerHTML = '';
        renderMeasures(VF, containerRef.current, measures, measuresPerLine);
        setRenderMs(performance.now() - t1);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('VexFlow render failed', err);
        setError(String(err));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [url, measuresPerLine, maxMeasures]);

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
        <div ref={containerRef} style={{ minHeight: height, padding: 8 }} />
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
        VexFlow · {status}{parseMs ? ` · parse ${parseMs.toFixed(0)}ms` : ''}{renderMs ? ` · render ${renderMs.toFixed(0)}ms` : ''}{` · ${maxMeasures} measure cap, single part`}
      </div>
    </div>
  );
}

// ────────────────────────── MusicXML mini-parser ───────────────────────────

const STEP_TO_VEX: Record<string, string> = {
  C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', A: 'a', B: 'b',
};
const ALTER_TO_ACC: Record<string, string> = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

function parseFirstPart(xml: string, maxMeasures: number): ParsedMeasure[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const part = doc.querySelector('part');
  if (!part) throw new Error('No <part> element');

  const out: ParsedMeasure[] = [];
  const measures = part.querySelectorAll('measure');
  let divisions = 12; // default
  for (let i = 0; i < measures.length && out.length < maxMeasures; i++) {
    const m = measures[i];
    const div = m.querySelector('attributes > divisions');
    if (div?.textContent) divisions = parseInt(div.textContent, 10);

    const notes: ParsedNote[] = [];
    m.querySelectorAll('note').forEach((n) => {
      // Skip chord-secondary notes (we just take chord roots for simplicity)
      const isChordTail = !!n.querySelector(':scope > chord');
      if (isChordTail) return;
      const isRest = !!n.querySelector(':scope > rest');
      const dur = parseInt(n.querySelector(':scope > duration')?.textContent || '0', 10);
      const type = n.querySelector(':scope > type')?.textContent || '';
      const dots = n.querySelectorAll(':scope > dot').length;

      let vexDur = typeToVex(type);
      if (!vexDur) vexDur = durationToVex(dur, divisions);
      if (dots > 0) vexDur += 'd';
      if (isRest) vexDur += 'r';

      let keys: string[] = ['b/4'];
      if (!isRest) {
        const step = n.querySelector(':scope > pitch > step')?.textContent || 'C';
        const oct = n.querySelector(':scope > pitch > octave')?.textContent || '4';
        const alter = n.querySelector(':scope > pitch > alter')?.textContent || '0';
        const acc = ALTER_TO_ACC[alter] ?? '';
        keys = [`${STEP_TO_VEX[step] || 'c'}${acc}/${oct}`];
      }

      const articEl = n.querySelector(':scope > notations > articulations > *');
      let articulation: 'staccato' | 'tenuto' | undefined;
      if (articEl?.tagName === 'staccato') articulation = 'staccato';
      else if (articEl?.tagName === 'tenuto') articulation = 'tenuto';

      notes.push({ keys, duration: vexDur, articulation });
    });

    if (notes.length > 0) {
      out.push({ number: i + 1, notes, divisions });
    }
  }
  return out;
}

function typeToVex(type: string): string | null {
  switch (type) {
    case 'whole': return 'w';
    case 'half': return 'h';
    case 'quarter': return 'q';
    case 'eighth': return '8';
    case '16th': return '16';
    case '32nd': return '32';
    default: return null;
  }
}

function durationToVex(d: number, divisions: number): string {
  const ratio = d / divisions;
  if (ratio >= 4) return 'w';
  if (ratio >= 2) return 'h';
  if (ratio >= 1) return 'q';
  if (ratio >= 0.5) return '8';
  if (ratio >= 0.25) return '16';
  return '32';
}

// ─────────────────────────── VexFlow renderer ──────────────────────────────

function renderMeasures(VF: any, host: HTMLDivElement, measures: ParsedMeasure[], perLine: number) {
  const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Articulation, Dot } = VF;
  const lineWidth = host.clientWidth || 720;
  const measureWidth = (lineWidth - 40) / perLine;
  const lineHeight = 140;
  const lineCount = Math.ceil(measures.length / perLine);

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  renderer.resize(lineWidth, lineCount * lineHeight + 40);
  const ctx = renderer.getContext();
  ctx.setFont('Arial', 10);

  for (let li = 0; li < lineCount; li++) {
    const y = 20 + li * lineHeight;
    for (let mi = 0; mi < perLine; mi++) {
      const idx = li * perLine + mi;
      if (idx >= measures.length) break;
      const m = measures[idx];
      const x = 20 + mi * measureWidth;
      const stave = new Stave(x, y, measureWidth);
      if (mi === 0) stave.addClef('treble');
      if (li === 0 && mi === 0) stave.addTimeSignature('4/4');
      stave.setContext(ctx).draw();

      const notes = m.notes.map((n) => {
        const note = new StaveNote({ keys: n.keys, duration: n.duration });
        if (n.duration.includes('d')) Dot.buildAndAttach([note], { all: true });
        n.keys.forEach((k, i) => {
          if (k.includes('#')) note.addModifier(new Accidental('#'), i);
          else if (k.includes('bb')) note.addModifier(new Accidental('bb'), i);
          else if (/[a-g]b\//.test(k)) note.addModifier(new Accidental('b'), i);
        });
        if (n.articulation === 'staccato') note.addModifier(new Articulation('a.').setPosition(3), 0);
        else if (n.articulation === 'tenuto') note.addModifier(new Articulation('a-').setPosition(3), 0);
        return note;
      });

      // Best-effort: pad/trim to fill exactly 4 beats to keep VexFlow happy.
      const totalBeats = notes.reduce((s, n) => s + beatVal(n.getDuration()), 0);
      if (Math.abs(totalBeats - 4) > 0.01) {
        // Skip layout if voice can't fill — just draw the stave as a marker
        continue;
      }

      const voice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables(notes);
      try {
        new Formatter().joinVoices([voice]).format([voice], measureWidth - 30);
        voice.draw(ctx, stave);
      } catch (e) {
        // VexFlow occasionally chokes on edge cases — leave the bare stave.
      }
    }
  }
}

function beatVal(d: string): number {
  const base = d.replace(/[rd]/g, '');
  const dotted = d.includes('d');
  let v = 0;
  switch (base) {
    case 'w': v = 4; break;
    case 'h': v = 2; break;
    case 'q': v = 1; break;
    case '8': v = 0.5; break;
    case '16': v = 0.25; break;
    case '32': v = 0.125; break;
    default: v = 0;
  }
  return dotted ? v * 1.5 : v;
}
