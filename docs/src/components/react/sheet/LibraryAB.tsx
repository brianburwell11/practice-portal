import { useState } from 'react';
import { OsmdRenderer } from './OsmdRenderer';
import { VerovioRenderer } from './VerovioRenderer';
import { VexFlowRenderer } from './VexFlowRenderer';

type LibKey = 'osmd' | 'verovio' | 'vexflow';

interface Props {
  url: string;
  height?: number;
}

const TABS: { key: LibKey; label: string; description: string }[] = [
  {
    key: 'osmd',
    label: 'OpenSheetMusicDisplay',
    description:
      'MusicXML in, SVG out. Highest level — load the file, call render(), get a usable score with cursors and accessibility.',
  },
  {
    key: 'verovio',
    label: 'Verovio',
    description:
      'C++ engraver compiled to WASM. MusicXML/MEI in, paginated SVG out. Best engraving quality of the three.',
  },
  {
    key: 'vexflow',
    label: 'VexFlow',
    description:
      'Low-level. You hand it Notes, Voices, Staves and call format()/draw(). No MusicXML parser — we wrote a tiny one for this demo.',
  },
];

export function LibraryAB({ url, height = 380 }: Props) {
  const [active, setActive] = useState<LibKey>('osmd');

  return (
    <div style={{ margin: '1.5rem 0' }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            style={{
              flex: 1,
              padding: '0.6rem 0.8rem',
              background: active === t.key ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: active === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: active === t.key ? 'var(--accent)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: active === t.key ? 600 : 400,
              fontFamily: 'inherit',
              fontSize: '0.95em',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{
        padding: '0.8rem 1rem',
        background: 'var(--surface-tint)',
        borderLeft: '1px solid var(--border)',
        borderRight: '1px solid var(--border)',
        fontSize: '0.85em',
        color: 'var(--text-secondary)',
      }}>
        {TABS.find((t) => t.key === active)?.description}
      </div>
      <div style={{
        padding: '0.6rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderTop: 'none',
      }}>
        {active === 'osmd' && <OsmdRenderer url={url} height={height} />}
        {active === 'verovio' && <VerovioRenderer url={url} height={height} />}
        {active === 'vexflow' && <VexFlowRenderer url={url} height={height} maxMeasures={16} />}
      </div>
    </div>
  );
}
