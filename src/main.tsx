import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import '@fontsource/hanken-grotesk/latin-700.css'
import './index.css'
import App from './App.tsx'
import { BandApp } from './components/band/BandApp.tsx'
import { BandPicker } from './components/band/BandPicker.tsx'
import { InvitePage } from './components/account/InvitePage.tsx'
import { RequireCan } from './components/account/RequireCan.tsx'
import { PrivacyPolicy } from './components/legal/PrivacyPolicy.tsx'
import { TermsOfService } from './components/legal/TermsOfService.tsx'

import { AddSongWizard, AlignSongPage, EditSongPage, NewBandPage } from './admin/lazyPages.ts'

const adminFallback = (
  <div className="min-h-screen bg-page text-gray-400 p-8">Loading admin...</div>
);

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<BandPicker />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route
          path="/admin/new-band"
          element={
            <Suspense fallback={adminFallback}>
              <RequireCan need="signedIn"><NewBandPage /></RequireCan>
            </Suspense>
          }
        />
        <Route path="/:bandSlug" element={<BandApp />}>
          <Route index element={<App />} />
          <Route
            path="admin/add-song"
            element={
              <Suspense fallback={adminFallback}>
                <RequireCan need="song.create"><AddSongWizard /></RequireCan>
              </Suspense>
            }
          />
          <Route
            path="admin/edit-song/:songId"
            element={
              <Suspense fallback={adminFallback}>
                <RequireCan need="song.content.write"><EditSongPage /></RequireCan>
              </Suspense>
            }
          />
          <Route
            path="admin/align/:songId"
            element={
              <Suspense fallback={adminFallback}>
                <RequireCan need="song.audio.write"><AlignSongPage /></RequireCan>
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
