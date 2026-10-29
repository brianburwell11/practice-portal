import { Link } from 'react-router-dom';
import { GUIDES } from './guideList';
import { HelpLayout } from './HelpLayout';

/** `/help`: every guide, newest additions last. */
export default function HelpIndex() {
  return (
    <HelpLayout title="Help" pageTitle="Help · Practice Portal" back={{ to: '/', label: 'Practice Portal' }}>
      <p>Guides to getting your band set up and practicing in Practice Portal.</p>
      <ul className="space-y-3">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link
              to={`/help/${g.slug}`}
              className="block rounded-lg border border-gray-800 bg-white/[0.03] p-4 hover:border-gray-600 transition-colors"
            >
              <span className="block font-semibold text-gray-100">{g.title}</span>
              <span className="block mt-1 text-sm text-gray-400">{g.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </HelpLayout>
  );
}
