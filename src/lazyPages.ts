import { lazy } from 'react';

/**
 * The band page and its player, code-split: the home, invite, legal and 404
 * pages don't download the audio engine, mixer or score code.
 */
export const BandApp = lazy(() => import('./components/band/BandApp.tsx').then((m) => ({ default: m.BandApp })));
/** Start downloading the player's code early (see `src/data/prefetch.ts`); `App` reuses the same download. */
export const loadApp = () => import('./App.tsx');
export const App = lazy(loadApp);

/** The Help center: its own chunk, since most visits never open it. */
export const HelpIndex = lazy(() => import('./help/HelpIndex.tsx'));
export const HelpGuide = lazy(() => import('./help/HelpGuide.tsx'));

/** The legal pages: rarely opened, so kept out of the first download. */
export const PrivacyPolicy = lazy(() => import('./components/legal/PrivacyPolicy.tsx').then((m) => ({ default: m.PrivacyPolicy })));
export const TermsOfService = lazy(() => import('./components/legal/TermsOfService.tsx').then((m) => ({ default: m.TermsOfService })));
export const Licenses = lazy(() => import('./components/legal/Licenses.tsx').then((m) => ({ default: m.Licenses })));
