/**
 * postinstall (and Docker build) step: copy Cesium's static runtime assets
 * into public/cesium/, which CESIUM_BASE_URL ('/cesium') points at. Fails the
 * install when they are missing — a Cesium upgrade that moves its build
 * output must not ship a globe with no Workers or Assets behind a green log.
 */
import { cpSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The subfolders Cesium loads at runtime from CESIUM_BASE_URL.
const REQUIRED = ['Workers', 'Assets', 'ThirdParty', 'Widgets']

// Resolve the cesium package root wherever npm hoisted it (workspace-safe).
const require = createRequire(import.meta.url)
const cesiumRoot = dirname(require.resolve('cesium'))

const sourceDir = join(cesiumRoot, 'Build', 'Cesium')
const destDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cesium')

const missing = REQUIRED.filter((name) => !existsSync(join(sourceDir, name)))
if (missing.length > 0) {
  console.error(`Cesium assets not found in ${sourceDir} (missing: ${missing.join(', ')})`)
  process.exit(1)
}

console.log('Copying Cesium assets...')
try {
  cpSync(sourceDir, destDir, { recursive: true })
  console.log('✓ Cesium assets copied successfully')
} catch (error) {
  console.error('Failed to copy Cesium assets:', error.message)
  process.exit(1)
}
