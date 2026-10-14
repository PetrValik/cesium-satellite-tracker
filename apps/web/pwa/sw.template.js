/* ORBITAL OPS service worker.
 *
 * Template only: the sw-stamp plugin in apps/web/vite.config.ts fills in the build id, the Cesium
 * version and the precache list (pwa/stamp.ts) and writes dist/sw.js. It lives outside public/ so
 * an unstamped copy is never served. The routing invariants are pinned by pwa/sw.test.ts.
 *
 * Routing, first match wins:
 *   non-GET, Range, only-if-cached          not intercepted
 *   cross-origin (tiles, Ion, photo APIs)   not intercepted
 *   /api and /api/*                         not intercepted, ever: live data stays on the network
 *   navigations                             network first; offline, slower than 4 s or 5xx: the precached shell
 *   /cesium/*                               cache first, keyed by the Cesium version (the files are not hashed)
 *   /assets/*, precached public files       cache first, keyed by the build id (precached at install)
 *   anything else (sw.js, other public/)    not intercepted
 *
 * The precached public files are the manifest, its icons and the icons index.html links. They are
 * not content-hashed, so they are fetched past the HTTP cache at install and live in the build-id
 * cache: every deploy that changes them (their bytes feed the build id) re-fetches them.
 *
 * Updates: the browser re-fetches /sw.js past the HTTP cache on navigations. A deploy changes the
 * stamped build id, so the new worker precaches, skips waiting, deletes the previous build's
 * caches and claims open pages. Navigations are network first, so an online visit always boots
 * the deployed index.html; the precached shell is only the offline or outage fallback.
 *
 * Kill switch: deploy a sw.js that deletes every oo-* cache and calls self.registration.unregister().
 */
const BUILD_ID = '__BUILD_ID__'
const CESIUM_VERSION = '__CESIUM_VERSION__'
const PRECACHE = __PRECACHE__

const CACHE_PREFIX = 'oo-'
const SHELL_CACHE = `${CACHE_PREFIX}shell-${BUILD_ID}`
const CESIUM_CACHE = `${CACHE_PREFIX}cesium-${CESIUM_VERSION}`
const SHELL_URL = '/'
const NAVIGATION_TIMEOUT_MS = 4000
// Unhashed public files (manifest, icons): served from the build-id cache like /assets/.
const PUBLIC_FILES = new Set(PRECACHE.filter((path) => path !== SHELL_URL && !path.startsWith('/assets/')))

self.addEventListener('install', (event) => {
  // A failed precache fails the install: the previous worker (or none) stays in charge.
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== CESIUM_CACHE) {
          await caches.delete(key)
        }
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || request.headers.has('range')) return
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') return event.respondWith(navigate(request))
  if (url.pathname.startsWith('/cesium/')) return event.respondWith(cacheFirst(event, CESIUM_CACHE))
  if (url.pathname.startsWith('/assets/') || PUBLIC_FILES.has(url.pathname)) {
    return event.respondWith(cacheFirst(event, SHELL_CACHE))
  }
})

async function precache() {
  const cache = await caches.open(SHELL_CACHE)
  try {
    await Promise.all(
      PRECACHE.map(async (path) => {
        // Hashed assets are immutable, so an HTTP-cached copy is as good; the shell and the unhashed
        // public files must come from the server.
        const hashed = path.startsWith('/assets/')
        const res = await fetch(new Request(path, { cache: hashed ? 'default' : 'reload' }))
        // The API answers unknown paths with index.html (200); never store that under an asset URL.
        if (res.status !== 200 || (path !== SHELL_URL && isHtml(res))) {
          throw new Error(`precache ${path}: HTTP ${res.status} ${res.headers.get('content-type') ?? ''}`)
        }
        await cache.put(path, res)
      }),
    )
  } catch (err) {
    // This build's cache is new and owned by nobody yet: drop the partial copy.
    await caches.delete(SHELL_CACHE)
    throw err
  }
}

async function navigate(request) {
  const network = fetch(request)
  network.catch(() => {}) // either awaited below or abandoned for the shell
  try {
    const res = await withTimeout(network, NAVIGATION_TIMEOUT_MS)
    if (res.status < 500) return res
    return (await cachedShell()) ?? res
  } catch {
    // Offline or slow: the shell if this build has one, otherwise keep waiting on the network.
    return (await cachedShell()) ?? network
  }
}

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(event.request)
  if (hit) return hit
  const res = await fetch(event.request)
  // Only a plain same-origin 200 that is not the SPA fallback page.
  if (res.status === 200 && res.type === 'basic' && !isHtml(res)) {
    event.waitUntil(cache.put(event.request, res.clone()).catch(() => {}))
  }
  return res
}

function cachedShell() {
  return caches.match(SHELL_URL, { cacheName: SHELL_CACHE })
}

function isHtml(res) {
  return (res.headers.get('content-type') ?? '').includes('text/html')
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no response in ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
