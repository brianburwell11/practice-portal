import { useState, useRef } from 'react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function TagInput({ tags, onChange, disabled, placeholder = 'Add tags…' }: Props) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    const additions: string[] = [];
    for (const p of parts) {
      if (!existing.has(p)) {
        existing.add(p);
        additions.push(p);
      }
    }
    if (additions.length > 0) onChange([...tags, ...additions]);
    setInput('');
  };

  const remove = (idx: number) => onChange(tags.filter((_, i) => i !== idx));

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 min-h-[38px] ${
        disabled ? 'opacity-60' : 'focus-within:border-blue-500'
      }`}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-700 text-xs text-gray-200"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); remove(i); }}
            disabled={disabled}
            className="text-gray-400 hover:text-red-400 leading-none"
            aria-label={`Remove ${tag}`}
          >
            &times;
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) {
            commit(v);
          } else {
            setInput(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(input);
          } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
            e.preventDefault();
            remove(tags.length - 1);
          }
        }}
        onBlur={() => commit(input)}
        disabled={disabled}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[80px] bg-transparent border-none text-sm text-gray-100 focus:outline-none px-1"
      />
    </div>
  );
}
