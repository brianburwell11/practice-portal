import { lazy } from 'react';

/**
 * The band page and its player, code-split: the home, invite, legal and 404
 * pages don't download the audio engine, mixer or score code.
 */
export const BandApp = lazy(() => import('./components/band/BandApp.tsx').then((m) => ({ default: m.BandApp })));
export const App = lazy(() => import('./App.tsx'));
