import { useState } from 'react';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useMixerStore } from '../../store/mixerStore';
import { TouchSlider } from '../ui/TouchSlider';
import { TempoControl } from './TempoControl';

interface Props {
  className?: string;
}

export function MasterSliders({ className = '' }: Props) {
  const engine = useAudioEngine();
  const { masterVolume, setMasterVolume } = useMixerStore();
  const [volEditing, setVolEditing] = useState(false);
  const [volEditValue, setVolEditValue] = useState('');

  const handleMasterVolume = (v: number) => {
    const clamped = Math.max(0, Math.min(1.5, v));
    setMasterVolume(clamped);
    engine.setMasterVolume(clamped);
  };

  const commitVolEdit = () => {
    const parsed = parseInt(volEditValue, 10);
    if (!isNaN(parsed)) {
      handleMasterVolume(parsed / 100);
    }
    setVolEditing(false);
  };

  return (
    <div
      className={`grid grid-cols-[2rem_1fr_2.5rem] md:grid-cols-[2rem_6rem_2.5rem] gap-x-2 gap-y-0.5 items-center ${className}`}
    >
      <label className="text-xs text-gray-400 text-right">Vol</label>
      <TouchSlider
        min={0}
        max={1.5}
        step={0.01}
        value={masterVolume}
        onChange={handleMasterVolume}
        onDoubleClick={() => handleMasterVolume(1.0)}
        label="Master Volume"
      />
      {volEditing ? (
        <input
          type="text"
          autoFocus
          value={volEditValue}
          onChange={(e) => setVolEditValue(e.target.value)}
          onBlur={commitVolEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitVolEdit();
            if (e.key === 'Escape') setVolEditing(false);
          }}
          className="w-full text-xs text-gray-300 font-mono text-right bg-gray-700 border border-gray-500 rounded px-1 py-0.5 outline-none focus:border-blue-500"
        />
      ) : (
        <button
          onClick={() => {
            setVolEditValue(String(Math.round(masterVolume * 100)));
            setVolEditing(true);
          }}
          className="text-xs text-gray-300 font-mono text-right hover:text-white cursor-text"
        >
          {Math.round(masterVolume * 100)}%
        </button>
      )}
      <TempoControl />
    </div>
  );
}
