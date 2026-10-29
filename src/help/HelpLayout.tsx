import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { LegalLinks } from '../components/legal/LegalPage';
import practicePortalMark from '../assets/practice-portal-mark-large.png';

/** The Help center's pages: the index and every guide. */
export function HelpLayout({ title, pageTitle, back, children }: {
  title: string;
  /** The tab title. */
  pageTitle: string;
  /** Where the link above the title goes: the Help index, or home from the index. */
  back: { to: string; label: string };
  children: ReactNode;
}) {
  usePageTitle(pageTitle);

  return (
    <div className="min-h-screen bg-page text-gray-300">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-12 space-y-8 leading-relaxed text-[15px]">
        <header className="space-y-3">
          <Link to={back.to} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300">
            <img src={practicePortalMark} alt="" className="h-5 w-auto" />
            {back.label}
          </Link>
          <h1 className="text-3xl font-bold text-gray-100">{title}</h1>
        </header>
        {children}
        <footer className="pt-4 border-t border-gray-800 space-y-4 text-center">
          <p className="text-sm text-gray-500">
            Can’t find what you need? Email{' '}
            <a href="mailto:support@practiceportal.app" className="text-blue-400 hover:text-blue-300">support@practiceportal.app</a>.
          </p>
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}

export function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-gray-100">{title}</h2>
      {children}
    </section>
  );
}
