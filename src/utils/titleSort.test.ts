import { describe, expect, it } from 'vitest';
import { compareTitles, titleSortKey } from './titleSort';

describe('titleSortKey', () => {
  it('drops a leading The, A or An, in any case', () => {
    expect(titleSortKey('The Chicken')).toBe('Chicken');
    expect(titleSortKey('a Night in Tunisia')).toBe('Night in Tunisia');
    expect(titleSortKey('AN Evening')).toBe('Evening');
  });

  it('leaves words that only start with an article alone', () => {
    expect(titleSortKey('Anthropology')).toBe('Anthropology');
    expect(titleSortKey('Theme from Shaft')).toBe('Theme from Shaft');
    expect(titleSortKey('Autumn Leaves')).toBe('Autumn Leaves');
  });

  it('keeps an article that is the whole title, or not at the start', () => {
    expect(titleSortKey('The')).toBe('The');
    expect(titleSortKey('A')).toBe('A');
    expect(titleSortKey('Take the A Train')).toBe('Take the A Train');
  });
});

describe('compareTitles', () => {
  it('files titles under the word after the article', () => {
    const titles = ['The Chicken', 'Birdland', 'A Night in Tunisia', 'An Evening', 'Cantaloupe Island', 'Anthropology'];
    expect([...titles].sort(compareTitles)).toEqual([
      'Anthropology', 'Birdland', 'Cantaloupe Island', 'The Chicken', 'An Evening', 'A Night in Tunisia',
    ]);
  });

  it('ignores case like the lists did', () => {
    expect(['beta', 'Alpha'].sort(compareTitles)).toEqual(['Alpha', 'beta']);
  });

  it('keeps a stable order for titles equal without the article', () => {
    expect(['The Wall', 'Wall'].sort(compareTitles)).toEqual(['The Wall', 'Wall'].sort((a, b) => a.localeCompare(b)));
  });
});
