import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBandStore } from '../store/bandStore';

interface Props {
  value: string;
  onChange: (color: string) => void;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function StemColorPicker({ value, onChange, children, className, title }: Props) {
  const palette = useBandStore((s) => s.currentBand?.palette ?? []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer"
        title={title ?? 'Click to change color'}
      >
        {children}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-3 space-y-2 w-max">
          {palette.length > 0 && (
            <>
              <div className="grid grid-cols-6 gap-1">
                {palette.map((color, i) => (
                  <button
                    key={`${color}-${i}`}
                    type="button"
                    onClick={() => {
                      onChange(color);
                      setOpen(false);
                    }}
                    className="w-5 h-5 rounded-full border border-gray-600 hover:scale-125 transition-transform cursor-pointer"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <div className="border-t border-gray-700 my-1" />
            </>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-400">Custom</span>
            <input
              type="color"
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setOpen(false);
              }}
              className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
            />
            <span className="text-xs font-mono text-gray-500">{value}</span>
          </label>
        </div>
      )}
    </div>
  );
}
