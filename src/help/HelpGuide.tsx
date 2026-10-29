import type { ComponentType } from 'react';
import { useParams } from 'react-router-dom';
import { NotFound } from '../components/NotFound';
import AddingSongs from './guides/AddingSongs';
import Faq from './guides/Faq';
import KeyboardShortcuts from './guides/KeyboardShortcuts';
import Notes from './guides/Notes';
import PracticingASong from './guides/PracticingASong';
import RolesAndPermissions from './guides/RolesAndPermissions';
import Setlists from './guides/Setlists';
import StartYourBand from './guides/StartYourBand';
import TimingAndLyrics from './guides/TimingAndLyrics';
import UsingTheMixer from './guides/UsingTheMixer';
import { guideBySlug } from './guideList';
import { HelpLayout } from './HelpLayout';

/** Each guide's page, by slug. A new guide: add it to guideList.ts and here. */
const PAGES: Record<string, ComponentType> = {
  'start-your-band': StartYourBand,
  'practicing-a-song': PracticingASong,
  'using-the-mixer': UsingTheMixer,
  notes: Notes,
  'keyboard-shortcuts': KeyboardShortcuts,
  'adding-songs': AddingSongs,
  'timing-and-lyrics': TimingAndLyrics,
  setlists: Setlists,
  'roles-and-permissions': RolesAndPermissions,
  faq: Faq,
};

/** `/help/:slug` */
export default function HelpGuide() {
  const { slug } = useParams<{ slug: string }>();
  const guide = guideBySlug(slug);
  const Page = slug ? PAGES[slug] : undefined;
  if (!guide || !Page) return <NotFound />;

  return (
    <HelpLayout title={guide.title} pageTitle={`${guide.title} · Practice Portal`} back={{ to: '/help', label: 'Help' }}>
      <Page />
    </HelpLayout>
  );
}
