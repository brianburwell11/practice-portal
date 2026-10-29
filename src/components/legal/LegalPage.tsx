import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../../hooks/usePageTitle';

/** Shared layout for the /legal pages. */
export function LegalPage({ title, effective, children }: { title: string; effective: string; children: ReactNode }) {
  usePageTitle(`${title} · Practice Portal`);

  return (
    <div className="min-h-screen bg-page text-gray-300">
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-8 leading-relaxed text-[15px]">
        <header className="space-y-2">
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-300">← Practice Portal</Link>
          <h1 className="text-3xl font-bold text-gray-100">{title}</h1>
          <p className="text-sm text-gray-500">Effective {effective}</p>
        </header>
        {children}
        <LegalLinks />
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

export function Mail({ to }: { to: string }) {
  return <a href={`mailto:${to}`} className="text-blue-400 hover:text-blue-300">{to}</a>;
}

/** "Privacy · Terms", for page footers. */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav className={`flex justify-center gap-3 text-xs text-gray-600 ${className}`}>
      <Link to="/legal/privacy" className="hover:text-gray-400">Privacy</Link>
      <span aria-hidden>·</span>
      <Link to="/legal/terms" className="hover:text-gray-400">Terms</Link>
    </nav>
  );
}
