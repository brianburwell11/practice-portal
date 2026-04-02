import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const hash = window.location.hash;
const isAddSong = import.meta.env.DEV && hash === '#/admin/add-song';
const isEditSong = import.meta.env.DEV && hash.startsWith('#/admin/edit-song/');
const AddSongWizard = isAddSong ? lazy(() => import('./admin/AddSongWizard.tsx')) : null;
const EditSongPage = isEditSong ? lazy(() => import('./admin/EditSongPage.tsx')) : null;
const AdminPage = AddSongWizard ?? EditSongPage;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AdminPage ? (
      <Suspense fallback={<div className="min-h-screen bg-gray-900 text-gray-400 p-8">Loading admin...</div>}>
        <AdminPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
