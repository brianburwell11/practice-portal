import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import '@fontsource/hanken-grotesk/latin-700.css'
import './index.css'
import { BandPicker } from './components/band/BandPicker.tsx'
import { InvitePage } from './components/account/InvitePage.tsx'
import { EmailUnsubscribe } from './components/account/EmailUnsubscribe.tsx'
import { RequireCan } from './components/account/RequireCan.tsx'
import { PrivacyPolicy } from './components/legal/PrivacyPolicy.tsx'
import { TermsOfService } from './components/legal/TermsOfService.tsx'
import { NotFound } from './components/NotFound.tsx'
import { DialogHost } from './components/ui/DialogHost.tsx'

import { AddSongWizard, AlignSongPage, EditSongPage, NewBandPage, SiteAdminPage } from './admin/lazyPages.ts'
import { App, BandApp, HelpGuide, HelpIndex } from './lazyPages.ts'

const adminFallback = (
  <div className="min-h-screen bg-page text-gray-400 p-8">Loading admin...</div>
);

const pageFallback = <div className="min-h-screen bg-page" />;

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<BandPicker />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/email/unsubscribe" element={<EmailUnsubscribe />} />
        <Route path="/help" element={<Suspense fallback={pageFallback}><HelpIndex /></Suspense>} />
        <Route path="/help/:slug" element={<Suspense fallback={pageFallback}><HelpGuide /></Suspense>} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route path="/admin" element={<Suspense fallback={pageFallback}><SiteAdminPage /></Suspense>} />
        <Route
          path="/admin/new-band"
          element={
            <Suspense fallback={adminFallback}>
              <RequireCan need="signedIn"><NewBandPage /></RequireCan>
            </Suspense>
          }
        />
        <Route path="/:bandSlug" element={<Suspense fallback={pageFallback}><BandApp /></Suspense>}>
          <Route index element={<Suspense fallback={null}><App /></Suspense>} />
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
        <Route path="*" element={<NotFound />} />
      </Routes>
      <DialogHost />
    </BrowserRouter>
  </StrictMode>,
)
