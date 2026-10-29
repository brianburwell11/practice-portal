import { lazy } from 'react';

/**
 * Admin pages, code-split: a Member never downloads them. Each route renders
 * its page inside `RequireCan`, so the chunk only loads once access is clear.
 */
export const AddSongWizard = lazy(() => import('./AddSongWizard.tsx'));
export const EditSongPage = lazy(() => import('./EditSongPage.tsx'));
export const AlignSongPage = lazy(() => import('./AlignSongPage.tsx'));
export const NewBandPage = lazy(() => import('./NewBandPage.tsx'));

/** The site admin dashboard (`/admin`). */
export const SiteAdminPage = lazy(() => import('./SiteAdminPage.tsx'));
