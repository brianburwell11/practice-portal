import { useState } from 'react';
import { measureBeatAt, measureBeatToTime } from '../../audio/tempoUtils';
import { useAudioEngine } from '../../hooks/useAudioEngine';
import { useSongStore } from '../../store/songStore';
import { useTransportStore } from '../../store/transportStore';
import { formatTime } from '../../utils/formatTime';

function parseTimeDigits(digits: string): number | null {
  if (!digits) return null;
  const padded = digits.padStart(3, '0');
  const s = parseInt(padded.slice(-2), 10);
  const m = parseInt(padded.slice(0, -2) || '0', 10);
  return m * 60 + s;
}

function formatTimeInput(digits: string): string {
  if (!digits) return '0:00';
  const padded = digits.slice(0, 4).padStart(3, '0');
  const s = padded.slice(-2);
  const m = padded.slice(0, -2) || '0';
  return `${parseInt(m, 10)}:${s}`;
}

const INPUT = 'text-sm bg-gray-700 border border-gray-500 rounded px-0.5 outline-none focus:border-blue-500 text-gray-300 font-mono';

/** Where playback is, as "m:ss / m:ss". Click the time to type one and jump there. */
export function TimeJump({ className = '', inputClassName = INPUT }: { className?: string; inputClassName?: string }) {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const duration = useTransportStore((s) => s.duration);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const commit = () => {
    setEditing(false);
    const t = parseTimeDigits(value);
    if (t !== null && t >= 0 && t <= duration) engine.seek(t);
  };

  return (
    <div className={className}>
      {editing ? (
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={formatTimeInput(value)}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
          }}
          aria-label="Jump to time, minutes and seconds"
          className={`w-[5ch] text-center ${inputClassName}`}
        />
      ) : (
        <button
          onClick={() => { setValue(''); setEditing(true); }}
          className="hover:text-gray-50 cursor-text"
          aria-label={`Time ${formatTime(position)}. Type a time to jump there`}
          title="Type a time to jump there"
        >{formatTime(position)}</button>
      )}
      <span> / {formatTime(duration)}</span>
    </div>
  );
}

/**
 * The measure|beat playback is at, by the song's tapMap. Click either number
 * to type one and jump there. Nothing without a tapMap.
 */
export function MeasureBeatJump({ className = '', inputClassName = INPUT }: { className?: string; inputClassName?: string }) {
  const engine = useAudioEngine();
  const position = useTransportStore((s) => s.position);
  const tapMap = useSongStore((s) => s.selectedSong?.tapMap);
  const [editing, setEditing] = useState<'measure' | 'beat' | null>(null);
  const [value, setValue] = useState('');

  if (!tapMap || tapMap.length === 0) return null;
  const mb = measureBeatAt(tapMap, position);
  const measure = mb?.measure ?? 0;
  const beat = mb?.beat ?? 0;

  const commit = () => {
    const field = editing;
    setEditing(null);
    const num = parseInt(value, 10);
    if (isNaN(num) || num <= 0) return;
    const t = field === 'measure'
      ? measureBeatToTime(tapMap, num, 1)
      : measureBeatToTime(tapMap, measure || 1, num);
    if (t !== null) engine.seek(t);
  };
  const start = (field: 'measure' | 'beat') => {
    setValue(String(field === 'measure' ? measure : beat));
    setEditing(field);
  };
  const input = (field: 'measure' | 'beat') => (
    <input
      type="text"
      inputMode="numeric"
      autoFocus
      onFocus={(e) => e.target.select()}
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
      }}
      aria-label={field === 'measure' ? 'Jump to measure' : 'Jump to beat'}
      className={`${field === 'measure' ? 'w-[3ch] text-right' : 'w-[2ch]'} ${inputClassName}`}
    />
  );

  return (
    <div className={`flex items-center ${className}`}>
      {editing === 'measure' ? input('measure') : (
        <button onClick={() => start('measure')} aria-label={`Measure ${measure}. Type a measure to jump there`} title="Type a measure to jump there" className="inline-block min-w-[2.5ch] text-right hover:text-gray-300 cursor-text">{measure}</button>
      )}
      <span className="text-gray-600 mx-0.5">|</span>
      {editing === 'beat' ? input('beat') : (
        <button onClick={() => start('beat')} aria-label={`Beat ${beat}. Type a beat to jump there`} title="Type a beat to jump there" className="inline-block min-w-[1.5ch] text-left hover:text-gray-300 cursor-text">{beat}</button>
      )}
    </div>
  );
}
