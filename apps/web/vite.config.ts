import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stampServiceWorker } from './pwa/stamp.ts'

// Resolve the cesium package root wherever npm hoisted it in the workspace tree.
const require = createRequire(import.meta.url)
const cesiumRoot = path.dirname(require.resolve('cesium'))
const cesiumVersion = (JSON.parse(readFileSync(path.join(cesiumRoot, 'package.json'), 'utf8')) as { version: string })
  .version

const swTemplate = fileURLToPath(new URL('./pwa/sw.template.js', import.meta.url))

/**
 * Unhashed public/ files the page asks for on every boot (index.html links them). They are
 * precached into the build-id cache next to the shell; the manifest's own icons join them at build
 * time. Their bytes feed the build id, so editing one of them is an update for clients too.
 */
const PUBLIC_PRECACHE = ['/manifest.webmanifest', '/favicon.ico', '/icon.svg', '/apple-touch-icon.png']

/**
 * Production builds only: stamps pwa/sw.template.js into <outDir>/sw.js once the bundle is on
 * disk. The precache is '/', the PUBLIC_PRECACHE files plus the manifest icons, and every hashed
 * file under assets/. The rest of public/ (including the 22 MB public/cesium tree) is never
 * precached.
 */
function serviceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'orbital-ops:sw-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle(_options, bundle) {
      const html = bundle['index.html']
      if (html?.type !== 'asset') throw new Error('sw-stamp: index.html is not in the bundle')

      // Installability needs the manifest and every icon it names, and the worker precaches them:
      // fail the build here, not the install prompt or the worker's install step.
      const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.webmanifest'), 'utf8')) as {
        icons?: { src: string }[]
      }
      const manifestIcons = (manifest.icons ?? []).map((icon) => {
        const url = new URL(icon.src, 'https://app.invalid/manifest.webmanifest')
        if (url.origin !== 'https://app.invalid') throw new Error(`sw-stamp: manifest icon is not same-origin: ${icon.src}`)
        return url.pathname
      })
      const publicFiles = [...new Set([...PUBLIC_PRECACHE, ...manifestIcons])]
      const missing = publicFiles.filter((url) => !existsSync(path.join(outDir, url.slice(1))))
      if (missing.length > 0) throw new Error(`sw-stamp: missing from ${outDir}: ${missing.join(', ')}`)

      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        .sort()
        .map((file) => `/${file}`)
      const precache = ['/', ...publicFiles, ...assets]
      const template = readFileSync(swTemplate, 'utf8')
      // Same inputs, same sw.js bytes: a rebuild without changes is not an update for clients.
      const hash = createHash('sha256')
        .update(template)
        .update(html.source)
        .update(JSON.stringify(precache))
        .update(cesiumVersion)
      for (const url of publicFiles) hash.update(readFileSync(path.join(outDir, url.slice(1))))
      const buildId = hash.digest('hex').slice(0, 12)
      writeFileSync(path.join(outDir, 'sw.js'), stampServiceWorker(template, { buildId, cesiumVersion, precache }))
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      cesium: cesiumRoot,
    },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  server: {
    proxy: {
      // API_PORT lets the dev api move off :8787 when something else holds it (e.g. a local proxy).
      '/api': `http://localhost:${process.env.API_PORT ?? 8787}`,
    },
  },
})
