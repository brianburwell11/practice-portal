import { Fragment, type ReactNode } from 'react';

/** A keyboard key, in monospace. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block rounded border border-gray-600 bg-gray-800 px-1 py-px font-mono text-[0.85em] leading-tight text-gray-100 whitespace-nowrap">
      {children}
    </kbd>
  );
}

/**
 * Text with keys marked in braces, keys shown as `Kbd`:
 * `"Play or pause {Space}"`. Text without braces comes back as is.
 */
export function withKeys(text: string): ReactNode {
  if (!text.includes('{')) return text;
  return text.split(/(\{[^}]+\})/).map((part, i) =>
    part.startsWith('{') && part.endsWith('}')
      ? <Kbd key={i}>{part.slice(1, -1)}</Kbd>
      : <Fragment key={i}>{part}</Fragment>,
  );
}
