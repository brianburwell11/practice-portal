import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { configApiPlugin } from './vite-plugin-config-api'
import { offlineAssetsPlugin } from './vite-plugin-offline-assets'

// A trusted local certificate (mkcert, in .certs/) when there is one: browsers
// refuse a service worker on the self-signed one, so offline mode needs it.
const certDir = fileURLToPath(new URL('./.certs/', import.meta.url))
const trustedCert = existsSync(`${certDir}localhost.pem`)
  ? { key: readFileSync(`${certDir}localhost-key.pem`), cert: readFileSync(`${certDir}localhost.pem`) }
  : null

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss(), ...(trustedCert ? [] : [basicSsl()]), configApiPlugin(), offlineAssetsPlugin()],
  server: { host: true, port: 5173, strictPort: true, ...(trustedCert ? { https: trustedCert } : {}) },
  // `npm run preview`: the production build on the same address as dev, with
  // the API from the production server (`npm run build:server`, then
  // `PORT=8080 node --env-file=.env dist-server/server.js`).
  preview: {
    host: true, port: 5173, strictPort: true,
    ...(trustedCert ? { https: trustedCert } : {}),
    proxy: {
      '/api': { target: 'http://localhost:8080', xfwd: true },
      '/healthz': { target: 'http://localhost:8080' },
    },
  },
  // Scan only the app for dependencies to pre-bundle. By default Vite scans
  // every .html in the project, which includes muse-encore's own viewer and
  // editor apps under vendor/ and their uninstalled dependencies.
  optimizeDeps: { entries: ['index.html'] },
  resolve: {
    alias: {
      // GPL-3.0 engraving engine, vendored as a submodule pinned to a reviewed
      // commit. Type-checked through src/types/muse-encore.d.ts only.
      'muse-encore': fileURLToPath(new URL('./vendor/muse-encore/src/index.ts', import.meta.url)),
    },
  },
})
