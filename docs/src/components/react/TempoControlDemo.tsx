import { useState } from 'react';
import { TouchSlider } from '@app/components/ui/TouchSlider';

const MIN = 0.25;
const MAX = 1.5;

export function TempoControlDemo({ initialTempo = 1.0 }: { initialTempo?: number }) {
  const [tempoRatio, setTempoRatio] = useState(initialTempo);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '1rem',
      background: '#1a1a2e',
      borderRadius: '8px',
      border: '1px solid #2A2A2C',
    }}>
      <span style={{ fontSize: '0.75rem', color: '#808080', whiteSpace: 'nowrap' }}>Speed</span>
      <div style={{ flex: 1 }}>
        <TouchSlider
          min={MIN}
          max={MAX}
          step={0.05}
          value={tempoRatio}
          onChange={setTempoRatio}
          onDoubleClick={() => setTempoRatio(1.0)}
          label="Speed"
        />
      </div>
      <span style={{
        fontSize: '0.75rem',
        color: '#E0DED8',
        fontFamily: 'monospace',
        width: '2.5rem',
        textAlign: 'right',
      }}>
        {Math.round(tempoRatio * 100)}%
      </span>
    </div>
  );
}
