import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const isAdminRoute = import.meta.env.DEV && window.location.hash === '#/admin/add-song';
const AddSongWizard = isAdminRoute ? lazy(() => import('./admin/AddSongWizard.tsx')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AddSongWizard ? (
      <Suspense fallback={<div className="min-h-screen bg-gray-900 text-gray-400 p-8">Loading admin...</div>}>
        <AddSongWizard />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
