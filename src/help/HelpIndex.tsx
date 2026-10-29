import { Link } from 'react-router-dom';
import { GUIDES, SECTIONS } from './guideList';
import { HelpLayout } from './HelpLayout';

/** `/help`: every guide, by section. */
export default function HelpIndex() {
  return (
    <HelpLayout title="Help" pageTitle="Help · Practice Portal" back={{ to: '/', label: 'Practice Portal' }}>
      <p>Guides to getting your band set up and practicing in Practice Portal.</p>
      {SECTIONS.map((section) => (
        <section key={section} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{section}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {GUIDES.filter((g) => g.section === section).map((g) => (
              <li key={g.slug}>
                <Link
                  to={`/help/${g.slug}`}
                  className="block h-full rounded-lg border border-gray-800 bg-white/[0.03] p-4 hover:border-gray-600 transition-colors"
                >
                  <span className="block font-semibold text-gray-100">{g.title}</span>
                  <span className="block mt-1 text-sm text-gray-400">{g.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </HelpLayout>
  );
}
