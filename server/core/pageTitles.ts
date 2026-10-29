/**
 * The title a page shows in its tab, worked out on the server so link
 * previews (Slack, iMessage, social) can show it: they read index.html and
 * never run the app. A link to a setlist or a song adds its name:
 * "Sooza Brass Band’s Practice Portal: Wiggle".
 *
 * Mirrors the titles the React pages set (`usePageTitle`, `BandApp`).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { guideBySlug } from '../../src/help/guideList';
import { bandPageTitle, previewTitle, SITE_TITLE } from '../../src/utils/pageTitle';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { hashToken } from './auth/sessions';

const FIXED: Record<string, string> = {
  '/': SITE_TITLE,
  '/legal/privacy': `Privacy Policy · ${SITE_TITLE}`,
  '/legal/terms': `Terms of Service · ${SITE_TITLE}`,
  '/email/unsubscribe': `Email preferences · ${SITE_TITLE}`,
  '/admin/new-band': SITE_TITLE,
  '/help': `Help · ${SITE_TITLE}`,
};

export async function pageTitleFor(pathname: string, query: URLSearchParams): Promise<string> {
  const fixed = FIXED[pathname.replace(/\/$/, '') || '/'];
  if (fixed) return fixed;
  const [first, second, ...rest] = pathname.split('/').filter(Boolean);

  // Help guides need no database.
  if (first === 'help' && second && rest.length === 0) {
    const guide = guideBySlug(second);
    return guide ? `${guide.title} · ${SITE_TITLE}` : `Page not found · ${SITE_TITLE}`;
  }

  if (!process.env.DATABASE_URL) return SITE_TITLE;
  try {
    if (first === 'invite' && second && rest.length === 0) {
      const [row] = await db().select({ name: schema.band.name }).from(schema.invite)
        .innerJoin(schema.band, eq(schema.band.id, schema.invite.bandId))
        .where(eq(schema.invite.tokenHash, hashToken(second)));
      return row ? `Join ${row.name} · ${SITE_TITLE}` : `Invite · ${SITE_TITLE}`;
    }

    // A band's page, or one of its admin pages.
    if (!first || (second !== undefined && second !== 'admin')) return `Page not found · ${SITE_TITLE}`;
    const [band] = await db().select({ id: schema.band.id, name: schema.band.name }).from(schema.band)
      .where(and(eq(schema.band.slug, first), isNull(schema.band.deletedAt)));
    if (!band) return `Page not found · ${SITE_TITLE}`; // the app shows its 404 page
    const title = bandPageTitle(band.name);
    if (second) return title;

    // ?setlist=<slug>, else ?song=<slug>: the same slugs the app puts in the URL.
    const setlistSlug = query.get('setlist');
    if (setlistSlug) {
      const [row] = await db().select({ name: schema.setlist.name }).from(schema.setlist)
        .where(and(eq(schema.setlist.bandId, band.id), eq(schema.setlist.slug, setlistSlug), isNull(schema.setlist.deletedAt)));
      return previewTitle(title, row?.name);
    }
    const songSlug = query.get('song');
    if (songSlug) {
      const [row] = await db().select({ title: schema.song.title }).from(schema.song)
        .where(and(eq(schema.song.bandId, band.id), eq(schema.song.slug, songSlug), isNull(schema.song.deletedAt)));
      return previewTitle(title, row?.title);
    }
    return title;
  } catch (err) {
    console.error('[pageTitles] lookup failed:', err);
    return SITE_TITLE;
  }
}
