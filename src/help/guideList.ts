/**
 * The Help center's guides: slug, title and one-line summary. Plain data,
 * so the server can title link previews with it (server/core/pageTitles.ts);
 * the pages themselves are in guides/ and wired up in HelpGuide.tsx.
 */
export interface GuideInfo {
  slug: string;
  title: string;
  summary: string;
}

export const GUIDES: GuideInfo[] = [
  {
    slug: 'roles-and-permissions',
    title: 'Roles and permissions',
    summary: 'The roles in a band, from Owner to Guest, and a table of what each one can do.',
  },
];

export function guideBySlug(slug: string | undefined): GuideInfo | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
