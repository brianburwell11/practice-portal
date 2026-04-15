import { getCamelotStyle } from '../utils/camelot';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function SongKeyInput({ value, onChange, disabled, placeholder = 'C, Bbm, F#m, 8B…' }: Props) {
  const trimmed = value.trim();
  const cs = trimmed ? getCamelotStyle(trimmed) : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 min-h-[38px] ${
        disabled ? 'opacity-60' : 'focus-within:border-blue-500'
      }`}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 min-w-[80px] bg-transparent border-none text-sm text-gray-100 focus:outline-none px-1"
      />
      {trimmed && (
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-xs ${cs ? '' : 'bg-gray-700 text-gray-400'}`}
          style={cs ? { backgroundColor: cs.bg, color: cs.color } : undefined}
        >
          {trimmed}
        </span>
      )}
    </div>
  );
}
