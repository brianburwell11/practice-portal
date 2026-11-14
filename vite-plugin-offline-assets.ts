import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Writes `offline-assets.json` into the build: every file the app might ask
 * for, so making a song "Available offline" can fetch them all up front
 * (`src/offline/pin.ts`). Without it, code that loads on demand, an editor
 * never opened, say, wouldn't be on the device on a plane.
 *
 * Lists the bundle's own files and the root-level files from `public/` the
 * service worker keeps (the manifest, icons, the SoundTouch processor). Not
 * source maps, not the worker itself, not text files nobody fetches offline.
 */
export function offlineAssetsPlugin(): Plugin {
  let base = '/'
  return {
    name: 'offline-assets',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    generateBundle(_options, bundle) {
      const fromBundle = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.endsWith('.html'))
      const publicDir = path.resolve('public')
      const fromPublic = readdirSync(publicDir).filter((f) =>
        statSync(path.join(publicDir, f)).isFile()
        && !f.startsWith('.')
        && f !== 'sw.js'
        && !/\.(txt|xml)$/.test(f),
      )
      const files = [...fromBundle, ...fromPublic].map((f) => base + f).sort()
      this.emitFile({ type: 'asset', fileName: 'offline-assets.json', source: JSON.stringify({ files }) })
    },
  }
}
