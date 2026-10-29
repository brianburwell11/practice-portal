import { useEffect } from 'react';

/** The tab title while this page is up; back to "Practice Portal" after. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = 'Practice Portal';
    };
  }, [title]);
}
