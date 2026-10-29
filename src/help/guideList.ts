/**
 * The Help center's guides: slug, title, one-line summary and the section
 * the index lists them under. Plain data, so the server can title link
 * previews with it (server/core/pageTitles.ts); the pages themselves are in
 * guides/ and wired up in HelpGuide.tsx.
 */
export const SECTIONS = ['Getting started', 'Practicing', 'Managing your band', 'Troubleshooting'] as const;
export type Section = (typeof SECTIONS)[number];

export interface GuideInfo {
  slug: string;
  title: string;
  summary: string;
  section: Section;
}

export const GUIDES: GuideInfo[] = [
  {
    slug: 'start-your-band',
    title: 'Start your band',
    summary: 'Create a band, add your first song and bring your bandmates in.',
    section: 'Getting started',
  },
  {
    slug: 'practicing-a-song',
    title: 'Practicing a song',
    summary: 'Play, loop, slow down, jump to a section, and follow the sheet music and lyrics.',
    section: 'Practicing',
  },
  {
    slug: 'using-the-mixer',
    title: 'Using the mixer',
    summary: 'Turn parts up or down, mute and solo them, and keep your favorite mix.',
    section: 'Practicing',
  },
  {
    slug: 'notes',
    title: 'Notes on songs',
    summary: 'Leave notes at a moment in a song for the whole band to see.',
    section: 'Practicing',
  },
  {
    slug: 'keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    summary: 'Every shortcut in the player and the editors, in one place.',
    section: 'Practicing',
  },
  {
    slug: 'adding-songs',
    title: 'Adding and editing songs',
    summary: 'Upload stems and sheet music, group parts, and change a song later.',
    section: 'Managing your band',
  },
  {
    slug: 'timing-and-lyrics',
    title: 'Timing and lyrics',
    summary: 'Mark a song’s sections and measures, and sync its lyrics.',
    section: 'Managing your band',
  },
  {
    slug: 'setlists',
    title: 'Setlists and collections',
    summary: 'Build sets for a gig, group songs into collections, and share them.',
    section: 'Managing your band',
  },
  {
    slug: 'roles-and-permissions',
    title: 'Roles and permissions',
    summary: 'The roles in a band, from Owner to Guest, and a table of what each one can do.',
    section: 'Managing your band',
  },
  {
    slug: 'faq',
    title: 'Troubleshooting and FAQ',
    summary: 'No sound, can’t add a note, can’t see a band, and other common questions.',
    section: 'Troubleshooting',
  },
];

export function guideBySlug(slug: string | undefined): GuideInfo | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
