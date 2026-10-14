// Fills the placeholders in pwa/sw.template.js. Pure, so the build (vite.config.ts) and the
// routing tests (sw.test.ts) stamp the template the same way.

export interface ServiceWorkerStamp {
  /** Names the shell cache; changes with the template, index.html, the precache list or a precached public file. */
  buildId: string
  /** Names the /cesium/ cache: those files are not content-hashed, so the version is their key. */
  cesiumVersion: string
  /**
   * Root-relative URLs cached at install: '/' (the offline shell), the unhashed public files the page
   * boots with (manifest, icons) and the hashed /assets/ files.
   */
  precache: readonly string[]
}

const PLACEHOLDERS = ['__BUILD_ID__', '__CESIUM_VERSION__', '__PRECACHE__'] as const
const ANY_PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g

export function stampServiceWorker(template: string, stamp: ServiceWorkerStamp): string {
  const { buildId, cesiumVersion, precache } = stamp
  // Both land inside JS string literals: allow nothing that could close the quote.
  if (!/^[0-9a-f]{6,64}$/.test(buildId)) throw new Error(`sw-stamp: bad build id "${buildId}"`)
  if (!/^[0-9A-Za-z.+-]+$/.test(cesiumVersion)) throw new Error(`sw-stamp: bad Cesium version "${cesiumVersion}"`)
  if (!precache.includes('/')) throw new Error("sw-stamp: the precache must include the '/' shell")
  for (const url of precache) {
    if (!url.startsWith('/') || url.startsWith('//')) throw new Error(`sw-stamp: precache URL must be root-relative: ${url}`)
  }
  for (const token of PLACEHOLDERS) {
    if (!template.includes(token)) throw new Error(`sw-stamp: template lacks ${token}`)
  }

  // Replacer functions: a string replacement would expand `$&`-style patterns inside the values.
  const stamped = template
    .replaceAll('__BUILD_ID__', () => buildId)
    .replaceAll('__CESIUM_VERSION__', () => cesiumVersion)
    .replaceAll('__PRECACHE__', () => JSON.stringify(precache))

  const left = stamped.match(ANY_PLACEHOLDER)
  if (left) throw new Error(`sw-stamp: unreplaced placeholder(s) ${[...new Set(left)].join(', ')}`)
  return stamped
}
