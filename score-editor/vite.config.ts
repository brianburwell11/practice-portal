/**
 * The MuseEncore score editor (GPL-3.0-only, vendor/muse-encore/editor),
 * built as our own page at /score-editor/ so the app can open it in a
 * same-site iframe and save the edited score back to the song.
 *
 * Built after the app (`npm run build:score-editor`) into dist/score-editor.
 * In dev the app's Vite server mounts this one at /score-editor/
 * (scoreEditorDev in ../vite.config.ts).
 *
 * The upstream editor build reads MuseScore's sources (a nested submodule we
 * don't check out) for translations, the soundfont, score templates and a
 * few dialog images. We don't need those, so `editorStubs` stands in for
 * them: English only, no "New score" templates, and the soundfont comes from
 * MuseScore's repository (the same default the MuseEncore viewer uses).
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { basicPitchModel } from '../vendor/muse-encore/shared/notedetection/basicpitch/vite-plugin-basicpitch'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const vendorRoot = path.join(projectRoot, 'vendor/muse-encore')

const LOCALES_ID = 'virtual:musescore-locales'
const SOUNDFONT_ID = '\0score-editor:soundfont'

function editorStubs(): Plugin {
  const soundfontFile = path.join(vendorRoot, 'shared/playback/soundfont.ts')
  return {
    name: 'score-editor-stubs',
    enforce: 'pre',
    resolveId(id, importer) {
      // English only: no languages to load, so i18n.ts uses the source strings.
      if (id === LOCALES_ID) return `\0${LOCALES_ID}`
      // "New score" templates: none (the menu lists no templates).
      if (id.endsWith('MuseScore/share/templates/categories.json')) return '\0score-editor:empty-list'
      // The picture in the MuseScore 3 migration dialog.
      if (id.includes('/MuseScore/src/') && id.endsWith('.png')) return '\0score-editor:no-image'
      // The editor's playback asks for the soundfont at its own base URL.
      if (importer?.endsWith('editor/playback/playbackcontroller.ts') && id.endsWith('shared/playback/soundfont')) {
        return SOUNDFONT_ID
      }
      return null
    },
    load(id) {
      if (id === `\0${LOCALES_ID}`) return 'export const LANGUAGES = {}\nexport const loaders = {}\n'
      if (id === '\0score-editor:empty-list') return 'export default []\n'
      if (id === '\0score-editor:no-image') return "export default ''\n"
      if (id === SOUNDFONT_ID) {
        const real = JSON.stringify(soundfontFile)
        return `export * from ${real}\n`
          + `import { SOUNDFONT_CDN_URL } from ${real}\n`
          + 'export function appSoundFontUrl() { return SOUNDFONT_CDN_URL }\n'
      }
      return null
    },
  }
}

export default defineConfig({
  root: here,
  base: '/score-editor/',
  // Its own pre-bundled dependencies: in dev it runs inside the app's Vite
  // server, and sharing node_modules/.vite would overwrite the app's.
  cacheDir: path.join(projectRoot, 'node_modules/.vite-score-editor'),
  plugins: [editorStubs(), react(), basicPitchModel()],
  // The engraving fonts, served at the base URL (e.g. /score-editor/leland/Leland.otf).
  publicDir: path.join(vendorRoot, 'fonts'),
  build: {
    outDir: path.join(projectRoot, 'dist/score-editor'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
  server: { fs: { allow: [projectRoot] } },
  optimizeDeps: { entries: [path.join(here, 'index.html')] },
  // The note detection's worker (TensorFlow.js) is an ES module.
  worker: { format: 'es' },
})
