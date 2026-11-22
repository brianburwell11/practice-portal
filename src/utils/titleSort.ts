/**
 * A–Z order for titles and names, the way a record shop files them: a
 * leading "The", "A" or "An" is skipped, so "The Chicken" sits with the Cs
 * and "A Night in Tunisia" with the Ns. The title itself is shown as it is.
 */
const LEADING_ARTICLE = /^(the|a|an)\s+/i;

/** What a title is filed under: without its leading article. */
export function titleSortKey(title: string): string {
  const trimmed = title.trim();
  const key = trimmed.replace(LEADING_ARTICLE, '');
  // A title that is only an article ("The") is filed under itself.
  return key || trimmed;
}

/** Compares two titles for A–Z order, ignoring a leading article. */
export function compareTitles(a: string, b: string): number {
  return titleSortKey(a).localeCompare(titleSortKey(b), undefined, { sensitivity: 'base' })
    // Same once the article is gone ("The Wall", "Wall"): the full titles decide.
    || a.localeCompare(b);
}
