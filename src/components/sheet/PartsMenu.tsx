import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartInfo } from './EngravedStripRenderer';

interface Props {
  parts: PartInfo[];
  hiddenPartIds: ReadonlySet<string>;
  onApply: (hidden: Set<string>) => void;
  /** Extra classes for the trigger button. */
  className?: string;
}

/**
 * The "parts (n/m)" dropdown: check the instrument parts to show, then apply.
 * Changes are a draft until applied (closing the menu any other way discards
 * them), and at least one part always stays visible.
 */
export function PartsMenu({ parts, hiddenPartIds, onApply, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const differs = useMemo(() => {
    if (draft.size !== hiddenPartIds.size) return true;
    for (const id of draft) if (!hiddenPartIds.has(id)) return true;
    return false;
  }, [draft, hiddenPartIds]);

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // Refuse to hide the last visible part rather than silently keeping it.
      if (parts.length - next.size - 1 < 1) return prev;
      next.add(id);
      return next;
    });
  };

  if (parts.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          // Start each opening from the committed selection, so an unapplied draft can't leak in.
          if (!open) setDraft(new Set(hiddenPartIds));
          setOpen(!open);
        }}
        className={`px-2 py-0.5 rounded ${hiddenPartIds.size > 0 ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'} ${className}`}
        title="Pick which instrument parts to display"
        aria-expanded={open}
      >
        parts ({parts.length - hiddenPartIds.size}/{parts.length})
      </button>
      {open && (
        <div
          className="theme-default absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded border border-gray-700 bg-gray-900 p-1 shadow-lg"
          role="menu"
        >
          {parts.map((p) => {
            const on = !draft.has(p.id);
            const isLastVisible = on && parts.length - draft.size <= 1;
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 rounded px-2 py-1 text-gray-200 ${isLastVisible ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-800'}`}
                title={isLastVisible ? 'At least one part must stay visible' : undefined}
              >
                <input type="checkbox" checked={on} disabled={isLastVisible} onChange={() => toggle(p.id)} />
                <span className="truncate">{p.name}</span>
              </label>
            );
          })}
          <div className="mt-1 border-t border-gray-700 pt-1">
            <button
              onClick={() => { onApply(new Set(draft)); setOpen(false); }}
              disabled={!differs}
              className={`w-full rounded px-2 py-1 text-xs ${differs ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
              title="Apply the part selection and redraw the score"
            >
              apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
