import { useRef, useState } from 'react';

interface EditableReadoutProps {
  /** What the readout shows, e.g. `-6.0` or `L42`. */
  text: string;
  /** The typed text as a value, or null to reject it. */
  parse: (text: string) => number | null;
  /** Applies the value, through the same handler the fader or knob uses. */
  onCommit: (value: number) => void;
  /** Names the field for screen readers, e.g. "Kick volume in dB". */
  label: string;
  className?: string;
  /** Width while editing; narrow it where the readout shares a row. */
  inputClassName?: string;
}

/**
 * A strip readout you can click and type into, like Logic's dB and pan
 * fields. Enter or leaving the field applies it, Escape cancels, and text
 * that doesn't parse puts the old value back.
 */
export function EditableReadout({
  text, parse, onCommit, label, className = '', inputClassName = 'w-14',
}: EditableReadoutProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Set once Enter or Escape has finished the edit, so the blur that can
  // follow as the input unmounts doesn't apply it (again, or after a cancel).
  const done = useRef(false);

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => { done.current = false; setDraft(text); }}
        title="Click to type a value"
        aria-label={`${label}: ${text}. Click to edit.`}
        className={`h-3.5 px-1 leading-none rounded-sm hover:bg-gray-700 cursor-text ${className}`}
      >
        {text}
      </button>
    );
  }

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const value = parse(draft);
    if (value !== null) onCommit(value);
    setDraft(null);
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { done.current = true; setDraft(null); }
      }}
      aria-label={label}
      spellCheck={false}
      className={`${inputClassName} h-3.5 px-1 text-center leading-none rounded-sm bg-gray-950 ring-1 ring-blue-500 outline-none ${className}`}
    />
  );
}
