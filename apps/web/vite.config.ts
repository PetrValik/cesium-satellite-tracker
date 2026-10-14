import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import path from 'node:path'

// Resolve the cesium package root wherever npm hoisted it in the workspace tree.
const require = createRequire(import.meta.url)
const cesiumRoot = path.dirname(require.resolve('cesium'))

export default defineConfig({
  plugins: [react()],
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
