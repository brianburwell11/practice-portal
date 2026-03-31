import { useState, useRef, useEffect } from 'react';

interface MarkerFormProps {
  beat: number;
  initialName?: string;
  initialColor?: string;
  onConfirm: (name: string, color: string) => void;
  onCancel: () => void;
}

export function MarkerForm({
  beat,
  initialName = '',
  initialColor = '#22c55e',
  onConfirm,
  onCancel,
}: MarkerFormProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleConfirm = () => {
    onConfirm(name || `Beat ${beat}`, color);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-700 rounded-lg">
      <span className="text-xs text-gray-400 font-mono shrink-0">
        Beat {beat}
      </span>

      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Marker name"
        className="flex-1 min-w-0 px-2 py-1 rounded bg-gray-800 text-gray-200 text-sm border border-gray-600 focus:border-blue-500 focus:outline-none"
      />

      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer border border-gray-600 bg-transparent"
      />

      <button
        onClick={handleConfirm}
        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm text-white transition-colors"
      >
        OK
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1 rounded bg-gray-600 hover:bg-gray-500 text-sm text-gray-200 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
