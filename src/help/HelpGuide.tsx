import type { ComponentType } from 'react';
import { useParams } from 'react-router-dom';
import { NotFound } from '../components/NotFound';
import RolesAndPermissions from './guides/RolesAndPermissions';
import { guideBySlug } from './guideList';
import { HelpLayout } from './HelpLayout';

/** Each guide's page, by slug. A new guide: add it to guideList.ts and here. */
const PAGES: Record<string, ComponentType> = {
  'roles-and-permissions': RolesAndPermissions,
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
