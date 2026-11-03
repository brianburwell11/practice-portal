import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { configApiPlugin } from './vite-plugin-config-api'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss(), basicSsl(), configApiPlugin()],
  server: { host: true },
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
