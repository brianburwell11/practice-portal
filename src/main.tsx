import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { BandApp } from './components/band/BandApp.tsx'
import { BandPicker } from './components/band/BandPicker.tsx'

const AddSongWizard = import.meta.env.DEV
  ? lazy(() => import('./admin/AddSongWizard.tsx'))
  : null;
const EditSongPage = import.meta.env.DEV
  ? lazy(() => import('./admin/EditSongPage.tsx'))
  : null;
const ManageBandsPage = import.meta.env.DEV
  ? lazy(() => import('./admin/ManageBandsPage.tsx'))
  : null;

const adminFallback = (
  <div className="min-h-screen bg-gray-900 text-gray-400 p-8">Loading admin...</div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BandPicker />} />
        {ManageBandsPage && (
          <Route
            path="/admin/bands"
            element={
              <Suspense fallback={adminFallback}>
                <ManageBandsPage />
              </Suspense>
            }
          />
        )}
        <Route path="/:bandSlug" element={<BandApp />}>
          <Route index element={<App />} />
          {AddSongWizard && (
            <Route
              path="admin/add-song"
              element={
                <Suspense fallback={adminFallback}>
                  <AddSongWizard />
                </Suspense>
              }
            />
          )}
          {EditSongPage && (
            <Route
              path="admin/edit-song/:songId"
              element={
                <Suspense fallback={adminFallback}>
                  <EditSongPage />
                </Suspense>
              }
            />
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
