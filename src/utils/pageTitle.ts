/**
 * Page titles, shared by the browser tab (React) and link previews (the
 * server writes them into index.html), so the two always match.
 */

export const SITE_TITLE = 'Practice Portal';

/** "Sooza Brass Band’s Practice Portal"; "The Hornets’ Practice Portal". */
export function bandPageTitle(bandName: string): string {
  return `${bandName}${/s$/i.test(bandName) ? '’' : '’s'} ${SITE_TITLE}`;
}

/** A link preview's title: the page's title, then the song or setlist it opens. */
export function previewTitle(pageTitle: string, item?: string | null): string {
  return item ? `${pageTitle}: ${item}` : pageTitle;
}
