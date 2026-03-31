import { useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useTransportStore } from '../../store/transportStore';

const MIN = 0.25;
const MAX = 1.5;

function clampRatio(v: number): number {
  return Math.max(MIN, Math.min(MAX, v));
}

export function TempoControl() {
  const engine = useAudioEngine();
  const tempoRatio = useTransportStore((s) => s.tempoRatio);
  const setTempoRatio = useTransportStore((s) => s.setTempoRatio);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleChange = (ratio: number) => {
    const clamped = clampRatio(ratio);
    engine.setTempo(clamped);
    setTempoRatio(clamped);
  };

  const commitEdit = () => {
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed)) {
      handleChange(parsed / 100);
    }
    setEditing(false);
  };

  return (
    <>
      <label className="text-xs text-gray-400 text-right">Speed</label>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={0.05}
        value={tempoRatio}
        onChange={(e) => handleChange(parseFloat(e.target.value))}
        onDoubleClick={() => handleChange(1.0)}
        className="w-full h-1.5 accent-blue-500 cursor-pointer"
      />
      {editing ? (
        <input
          type="text"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-full text-xs text-gray-300 font-mono text-right bg-gray-700 border border-gray-500 rounded px-1 py-0.5 outline-none focus:border-blue-500"
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(String(Math.round(tempoRatio * 100)));
            setEditing(true);
          }}
          className="text-xs text-gray-300 font-mono text-right hover:text-white cursor-text"
        >
          {Math.round(tempoRatio * 100)}%
        </button>
      )}
    </>
  );
}
