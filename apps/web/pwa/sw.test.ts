// Routing invariants of the service worker. The real template, stamped by the same helper the
// build uses, runs in a node:vm context with a fake `self`, Cache Storage and network.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stampServiceWorker } from './stamp'

const ORIGIN = 'https://orbit.test'
const TEMPLATE = readFileSync(fileURLToPath(new URL('./sw.template.js', import.meta.url)), 'utf8')
const BUILD_ID = 'abc123def456'
const CESIUM_VERSION = '1.138.0'
/** Unhashed public files, as the build lists them: the index.html links plus a manifest icon. */
const PUBLIC_FILES = ['/manifest.webmanifest', '/favicon.ico', '/icon.svg', '/apple-touch-icon.png', '/icons/icon-192.png']
const PRECACHE = ['/', ...PUBLIC_FILES, '/assets/index-AAAA.js', '/assets/index-BBBB.css']
const SHELL_CACHE = `oo-shell-${BUILD_ID}`
const CESIUM_CACHE = `oo-cesium-${CESIUM_VERSION}`

type Network = (request: Request) => Response | Promise<Response>
type Listener = (event: object) => void

const href = (input: Request | string | URL) =>
  new URL(input instanceof Request ? input.url : input, ORIGIN).href

const CONTENT_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  webmanifest: 'application/manifest+json',
  png: 'image/png',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

/** What the app server answers: a file by extension, else index.html (the SPA fallback, also for '/'). */
const appServer: Network = (request) => {
  const path = new URL(request.url).pathname
  const ext = /\.([a-z]+)$/.exec(path)?.[1]
  const type = ext && CONTENT_TYPES[ext]
  if (type) return text(`${ext}:${path}`, type)
  return text('<!doctype html><title>NEW</title>', 'text/html; charset=utf-8')
}

function text(body: string, type: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': type } })
}

class FakeCache {
  readonly entries = new Map<string, Response>()
  async match(request: Request | string) {
    return this.entries.get(href(request))?.clone()
  }
  async put(request: Request | string, response: Response) {
    this.entries.set(href(request), response)
  }
}

/** Loads a freshly stamped worker. Nothing is installed until `install()` runs. */
function loadWorker(initialNetwork: Network = appServer) {
  const store = new Map<string, FakeCache>()
  const listeners = new Map<string, Listener>()
  const networkLog: { url: string; cache: Request['cache'] }[] = []
  let network = initialNetwork

  // Relative URLs resolve against the worker's origin, as they do in a real ServiceWorkerGlobalScope.
  class WorkerRequest extends Request {
    constructor(input: Request | string | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init)
    }
  }
  const caches = {
    async open(name: string) {
      let cache = store.get(name)
      if (!cache) store.set(name, (cache = new FakeCache()))
      return cache
    },
    async keys() {
      return [...store.keys()]
    },
    async delete(name: string) {
      return store.delete(name)
    },
    async match(request: Request | string, options?: { cacheName?: string }) {
      const names = options?.cacheName ? [options.cacheName] : [...store.keys()]
      for (const name of names) {
        const hit = await store.get(name)?.match(request)
        if (hit) return hit
      }
      return undefined
    },
  }
  const self = {
    location: new URL('/sw.js', ORIGIN),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  }
  const fetchFromNetwork = async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new WorkerRequest(input, init)
    networkLog.push({ url: request.url, cache: request.cache })
    const response = await network(request)
    // Same-origin answers are 'basic' in a browser; Node's Response says 'default'.
    if (new URL(request.url).origin === ORIGIN) Object.defineProperty(response, 'type', { value: 'basic' })
    return response
  }

  vm.runInNewContext(
    stampServiceWorker(TEMPLATE, { buildId: BUILD_ID, cesiumVersion: CESIUM_VERSION, precache: PRECACHE }),
    {
      self,
      caches,
      fetch: fetchFromNetwork,
      Request: WorkerRequest,
      Response,
      URL,
      // Looked up per call, so vi.useFakeTimers() reaches the worker's navigation timeout.
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      console,
    },
  )

  const extendable = async (type: string) => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (pending = p) })
    await pending
  }

  /** Dispatches a fetch event. `response` is undefined when the worker did not call respondWith. */
  function dispatch(url: string, init: RequestInit & { navigate?: boolean; cacheMode?: Request['cache'] } = {}) {
    const { navigate, cacheMode, ...requestInit } = init
    const request = new Request(new URL(url, ORIGIN), requestInit)
    if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' })
    if (cacheMode) Object.defineProperty(request, 'cache', { value: cacheMode })
    let response: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    listeners.get('fetch')!({
      request,
      respondWith: (r: Response | Promise<Response>) => (response = Promise.resolve(r)),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    return {
      response,
      /** The response plus any cache writes the worker queued with waitUntil. */
      async settled() {
        const res = await response
        await Promise.all(waits)
        return res
      },
    }
  }

  return {
    store,
    self,
    networkLog,
    setNetwork: (next: Network) => (network = next),
    install: () => extendable('install'),
    activate: () => extendable('activate'),
    dispatch,
    cached: (cacheName: string, url: string) => store.get(cacheName)?.entries.has(href(url)) ?? false,
  }
}

async function installedWorker() {
  const worker = loadWorker()
  await worker.install()
  worker.networkLog.length = 0
  return worker
}

afterEach(() => {
  vi.useRealTimers()
})

describe('stampServiceWorker', () => {
  const stamp = { buildId: BUILD_ID, cesiumVersion: CESIUM_VERSION, precache: PRECACHE }

  it('fills every placeholder and leaves none behind', () => {
    const out = stampServiceWorker(TEMPLATE, stamp)
    expect(out).toContain(`const BUILD_ID = '${BUILD_ID}'`)
    expect(out).toContain(`const CESIUM_VERSION = '${CESIUM_VERSION}'`)
    expect(out).toContain(`const PRECACHE = ${JSON.stringify(PRECACHE)}`)
    expect(out).not.toMatch(/__[A-Z][A-Z0-9_]*__/)
  })

  it('refuses values that could break out of the string literals', () => {
    expect(() => stampServiceWorker(TEMPLATE, { ...stamp, cesiumVersion: "1.0'; self.x()" })).toThrow(/Cesium version/)
    expect(() => stampServiceWorker(TEMPLATE, { ...stamp, buildId: 'NOT-HEX' })).toThrow(/build id/)
  })

  it('refuses a precache without the shell or with a non-root-relative URL', () => {
    expect(() => stampServiceWorker(TEMPLATE, { ...stamp, precache: ['/assets/a.js'] })).toThrow(/'\/' shell/)
    expect(() => stampServiceWorker(TEMPLATE, { ...stamp, precache: ['/', '//cdn.test/a.js'] })).toThrow(/root-relative/)
  })

  it('fails on a template that lacks a placeholder or carries an unknown one', () => {
    expect(() => stampServiceWorker(TEMPLATE.replace('__PRECACHE__', '[]'), stamp)).toThrow(/lacks __PRECACHE__/)
    expect(() => stampServiceWorker(`${TEMPLATE}\nconst X = '__NEW_TOKEN__'`, stamp)).toThrow(/__NEW_TOKEN__/)
  })
})

describe('service worker: requests it must never answer', () => {
  it('never intercepts /api, whatever the method or mode, even with warm caches', async () => {
    const worker = await installedWorker()
    const requests = [
      worker.dispatch('/api/satellites'),
      worker.dispatch('/api/satellites?group=active'),
      worker.dispatch('/api'),
      worker.dispatch('/api', { navigate: true }),
      worker.dispatch('/api/ships', { navigate: true }),
      worker.dispatch('/api/x', { method: 'POST', body: '{}' }),
      worker.dispatch('/api/x', { method: 'DELETE' }),
    ]
    for (const r of requests) expect(r.response).toBeUndefined()
    expect(worker.networkLog).toEqual([])
  })

  it('never intercepts cross-origin requests (imagery tiles, Ion, photo APIs)', async () => {
    const worker = await installedWorker()
    expect(worker.dispatch('https://tile.openstreetmap.org/3/1/2.png').response).toBeUndefined()
    expect(worker.dispatch('https://api.cesium.com/v1/assets/1/endpoint').response).toBeUndefined()
    // Same path shapes on another origin get no special treatment either.
    expect(worker.dispatch('https://cdn.test/assets/index-AAAA.js').response).toBeUndefined()
    expect(worker.dispatch('https://cdn.test/cesium/Workers/a.js').response).toBeUndefined()
    expect(worker.dispatch('https://cdn.test/manifest.webmanifest').response).toBeUndefined()
    expect(worker.networkLog).toEqual([])
  })

  it('leaves non-GET, Range and only-if-cached requests to the browser', async () => {
    const worker = await installedWorker()
    expect(worker.dispatch('/assets/index-AAAA.js', { method: 'POST', body: 'x' }).response).toBeUndefined()
    expect(worker.dispatch('/', { method: 'HEAD' }).response).toBeUndefined()
    expect(worker.dispatch('/cesium/Assets/a.bin', { headers: { range: 'bytes=0-9' } }).response).toBeUndefined()
    expect(worker.dispatch('/apple-touch-icon.png', { headers: { range: 'bytes=0-9' } }).response).toBeUndefined()
    expect(worker.dispatch('/manifest.webmanifest', { method: 'HEAD' }).response).toBeUndefined()
    expect(worker.dispatch('/cesium/Workers/a.js', { mode: 'no-cors', cacheMode: 'only-if-cached' }).response).toBeUndefined()
  })

  it('leaves its own script, a non-navigation /, and public files it did not precache to the browser', async () => {
    const worker = await installedWorker()
    for (const path of ['/sw.js', '/', '/robots.txt', '/icons/icon-512.png']) {
      expect(worker.dispatch(path).response).toBeUndefined()
    }
    expect(worker.networkLog).toEqual([])
  })
})

describe('service worker: install, update and activate', () => {
  it('precaches the shell and the unhashed public files fresh from the server, the hashed assets, then skips waiting', async () => {
    const worker = loadWorker()
    await worker.install()
    for (const url of PRECACHE) expect(worker.cached(SHELL_CACHE, url)).toBe(true)
    expect(worker.networkLog).toEqual([
      { url: `${ORIGIN}/`, cache: 'reload' },
      { url: `${ORIGIN}/manifest.webmanifest`, cache: 'reload' },
      { url: `${ORIGIN}/favicon.ico`, cache: 'reload' },
      { url: `${ORIGIN}/icon.svg`, cache: 'reload' },
      { url: `${ORIGIN}/apple-touch-icon.png`, cache: 'reload' },
      { url: `${ORIGIN}/icons/icon-192.png`, cache: 'reload' },
      { url: `${ORIGIN}/assets/index-AAAA.js`, cache: 'default' },
      { url: `${ORIGIN}/assets/index-BBBB.css`, cache: 'default' },
    ])
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce()
  })

  it('fails the install instead of caching the SPA fallback page as an asset', async () => {
    const worker = loadWorker((request) =>
      request.url.endsWith('.css') ? text('<!doctype html>', 'text/html') : appServer(request),
    )
    await expect(worker.install()).rejects.toThrow(/index-BBBB\.css/)
    expect(worker.self.skipWaiting).not.toHaveBeenCalled()
    expect(worker.store.has(SHELL_CACHE)).toBe(false) // no half-filled cache left behind
  })

  it('fails the install when a precached public file is answered by the SPA fallback (missing from dist)', async () => {
    const worker = loadWorker((request) =>
      request.url.endsWith('/favicon.ico') ? text('<!doctype html>', 'text/html') : appServer(request),
    )
    await expect(worker.install()).rejects.toThrow(/favicon\.ico/)
    expect(worker.store.has(SHELL_CACHE)).toBe(false)
  })

  it('fails the install when a precached URL is missing', async () => {
    const worker = loadWorker((request) =>
      request.url.endsWith('.js') ? text('gone', 'text/plain', 404) : appServer(request),
    )
    await expect(worker.install()).rejects.toThrow(/HTTP 404/)
    expect(worker.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('on activate deletes every other oo-* cache, keeps foreign caches, and claims open pages', async () => {
    const worker = await installedWorker()
    // A previous build's shell, a previous Cesium version, and a cache this worker does not own.
    for (const name of ['oo-shell-0ld0ld0ld0ld', 'oo-cesium-1.137.0', 'someone-else']) {
      worker.store.set(name, new FakeCache())
    }
    await worker.activate()
    expect([...worker.store.keys()].sort()).toEqual([SHELL_CACHE, 'someone-else'].sort())
    expect(worker.self.clients.claim).toHaveBeenCalledOnce()
  })

  it('keeps the current Cesium cache across a deploy that did not bump Cesium', async () => {
    const worker = await installedWorker()
    await worker.dispatch('/cesium/Workers/a.js').settled()
    await worker.activate()
    expect(worker.cached(CESIUM_CACHE, '/cesium/Workers/a.js')).toBe(true)
  })
})

describe('service worker: navigations', () => {
  it('goes to the network first, so an online visit always boots the deployed index.html', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => text('<title>DEPLOYED</title>', 'text/html'))
    const res = await worker.dispatch('/', { navigate: true }).settled()
    expect(await res!.text()).toBe('<title>DEPLOYED</title>')
    // The precached shell is never overwritten at runtime: it must keep matching its own assets.
    expect(await (await worker.store.get(SHELL_CACHE)!.match('/'))!.text()).toBe('<!doctype html><title>NEW</title>')
  })

  it('passes a 4xx through untouched', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => text('nope', 'text/plain', 404))
    expect((await worker.dispatch('/missing', { navigate: true }).settled())!.status).toBe(404)
  })

  it('falls back to the precached shell when offline', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => Promise.reject(new TypeError('Failed to fetch')))
    const res = await worker.dispatch('/', { navigate: true }).settled()
    expect(await res!.text()).toBe('<!doctype html><title>NEW</title>')
  })

  it('falls back to the precached shell on a 5xx (e.g. a 502 while the container restarts)', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => text('bad gateway', 'text/plain', 502))
    const res = await worker.dispatch('/anything', { navigate: true }).settled()
    expect(await res!.text()).toBe('<!doctype html><title>NEW</title>')
  })

  it('falls back to the precached shell after 4 s without an answer', async () => {
    const worker = await installedWorker()
    vi.useFakeTimers()
    worker.setNetwork(() => new Promise<Response>(() => {}))
    const pending = worker.dispatch('/', { navigate: true }).settled()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await (await pending)!.text()).toBe('<!doctype html><title>NEW</title>')
  })

  it('without a precached shell, keeps waiting on a slow network instead of failing', async () => {
    const worker = loadWorker()
    vi.useFakeTimers()
    worker.setNetwork(() => new Promise<Response>((resolve) => setTimeout(() => resolve(text('late', 'text/html')), 6000)))
    const pending = worker.dispatch('/', { navigate: true }).settled()
    await vi.advanceTimersByTimeAsync(6000)
    expect(await (await pending)!.text()).toBe('late')
  })

  it('without a precached shell, an offline navigation is a network error', async () => {
    const worker = loadWorker(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(worker.dispatch('/', { navigate: true }).response).rejects.toThrow(/Failed to fetch/)
  })
})

describe('service worker: cache-first assets', () => {
  it('serves precached /assets/ without touching the network', async () => {
    const worker = await installedWorker()
    const res = await worker.dispatch('/assets/index-AAAA.js').settled()
    expect(await res!.text()).toBe('js:/assets/index-AAAA.js')
    expect(worker.networkLog).toEqual([])
  })

  it('serves the manifest and the page icons from the build cache when offline', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => Promise.reject(new TypeError('Failed to fetch')))
    for (const path of PUBLIC_FILES) {
      const res = await worker.dispatch(path).settled()
      expect(res!.status).toBe(200)
      expect(await res!.text()).toBe(`${/\.([a-z]+)$/.exec(path)![1]}:${path}`)
    }
    expect(worker.networkLog).toEqual([])
  })

  it('drops the previous build\'s copies of the public files on activate', async () => {
    const worker = await installedWorker()
    const previous = new FakeCache()
    await previous.put('/manifest.webmanifest', text('old', 'application/manifest+json'))
    worker.store.set('oo-shell-0ld0ld0ld0ld', previous)
    await worker.activate()
    const res = await worker.dispatch('/manifest.webmanifest').settled()
    expect(await res!.text()).toBe('webmanifest:/manifest.webmanifest')
    expect(worker.store.has('oo-shell-0ld0ld0ld0ld')).toBe(false)
  })

  it('caches /cesium/ on first use under the Cesium version: two requests, one network hit', async () => {
    const worker = await installedWorker()
    await worker.dispatch('/cesium/Workers/createVerticesFromHeightmap.js').settled()
    const res = await worker.dispatch('/cesium/Workers/createVerticesFromHeightmap.js').settled()
    expect(await res!.text()).toBe('js:/cesium/Workers/createVerticesFromHeightmap.js')
    expect(worker.networkLog).toHaveLength(1)
    expect(worker.cached(CESIUM_CACHE, '/cesium/Workers/createVerticesFromHeightmap.js')).toBe(true)
    expect(worker.cached(SHELL_CACHE, '/cesium/Workers/createVerticesFromHeightmap.js')).toBe(false)
  })

  it('never caches the SPA fallback page under a /cesium/ or /assets/ URL', async () => {
    const worker = await installedWorker()
    for (const path of ['/cesium/Workers/missing', '/assets/missing-CCCC']) {
      const res = await worker.dispatch(path).settled()
      expect(res!.headers.get('content-type')).toContain('text/html') // passed through to the page
      await worker.dispatch(path).settled()
    }
    expect(worker.networkLog).toHaveLength(4)
    expect(worker.cached(CESIUM_CACHE, '/cesium/Workers/missing')).toBe(false)
    expect(worker.cached(SHELL_CACHE, '/assets/missing-CCCC')).toBe(false)
  })

  it('never caches an error answer', async () => {
    const worker = await installedWorker()
    worker.setNetwork(() => text('err', 'text/javascript', 500))
    expect((await worker.dispatch('/cesium/Workers/a.js').settled())!.status).toBe(500)
    expect(worker.cached(CESIUM_CACHE, '/cesium/Workers/a.js')).toBe(false)
  })
})
