import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Building blocks the guides share, so they read and look alike. */

/** A key or button name: <Key>N</Key>, <Key>Shift</Key>. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block rounded border border-gray-600 bg-gray-800 px-1.5 py-px font-mono text-[0.8em] text-gray-100 whitespace-nowrap">
      {children}
    </kbd>
  );
}

/** Something on screen, as it's labeled there: <Ui>Add Song</Ui>. */
export function Ui({ children }: { children: ReactNode }) {
  return <span className="font-medium text-gray-100">{children}</span>;
}

/** A link to another guide. */
export function GuideLink({ slug, children }: { slug: string; children: ReactNode }) {
  return <Link to={`/help/${slug}`} className="text-blue-400 hover:text-blue-300">{children}</Link>;
}

/** Numbered steps. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal pl-5 space-y-2 marker:text-gray-500">{children}</ol>;
}

/** A bulleted list. */
export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-5 space-y-2 marker:text-gray-600">{children}</ul>;
}

/** A side note: who can do this, or something easy to miss. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-gray-800 bg-white/[0.03] px-4 py-3 text-sm text-gray-400">{children}</p>
  );
}

/** A two-column table: what you want to do, and how. Scrolls sideways on narrow screens if it must. */
export function Table({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-900 text-left text-gray-200">
            <th scope="col" className="px-3 py-2 font-semibold">{head[0]}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i} className="border-t border-gray-800 align-top">
              <td className="px-3 py-2 text-gray-300">{a}</td>
              <td className="px-3 py-2 text-gray-300">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One question and its answer, for the FAQ. */
export function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-gray-100">{q}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
