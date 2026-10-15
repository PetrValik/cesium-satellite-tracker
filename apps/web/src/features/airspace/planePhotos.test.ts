import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  /** Mirror of lib/api's ApiError; stable identity across module resets. */
  class MockApiError extends Error {
    readonly status: number | null
    constructor(message: string, status: number | null) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return { ApiError: MockApiError, planePhoto: vi.fn() }
})

vi.mock('../../lib/api', () => ({ ApiError: h.ApiError, api: { planePhoto: h.planePhoto } }))

const PHOTO = { thumbUrl: 'https://t/large.jpg', link: 'https://p/1', photographer: 'A. Spotter' }

// The module owns a per-session cache — re-import it fresh per test.
type PhotosModule = typeof import('./planePhotos')
let mod: PhotosModule

beforeEach(async () => {
  h.planePhoto.mockReset()
  vi.resetModules()
  mod = await import('./planePhotos')
})

describe('fetchPlanePhoto', () => {
  it('returns a photo and serves the airframe from cache afterwards', async () => {
    h.planePhoto.mockResolvedValue(PHOTO)
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toEqual(PHOTO)
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toEqual(PHOTO)
    expect(h.planePhoto).toHaveBeenCalledTimes(1)
  })

  it('names an unknown photographer', async () => {
    h.planePhoto.mockResolvedValue({ ...PHOTO, photographer: null })
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toMatchObject({ photographer: 'unknown' })
  })

  it('caches "no photo" so the API is not re-asked', async () => {
    h.planePhoto.mockResolvedValue(null)
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toBeNull()
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toBeNull()
    expect(h.planePhoto).toHaveBeenCalledTimes(1)
  })

  it('does not cache an HTTP failure (e.g. 429), so the next selection retries', async () => {
    h.planePhoto.mockRejectedValueOnce(new h.ApiError('Too Many Requests', 429))
    h.planePhoto.mockResolvedValueOnce(PHOTO)
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toBeNull()
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toEqual(PHOTO)
    expect(h.planePhoto).toHaveBeenCalledTimes(2)
  })

  it('does not cache a network failure', async () => {
    h.planePhoto.mockRejectedValueOnce(new h.ApiError('unreachable', null))
    h.planePhoto.mockResolvedValueOnce(null)
    await mod.fetchPlanePhoto('4b1814')
    await mod.fetchPlanePhoto('4b1814')
    expect(h.planePhoto).toHaveBeenCalledTimes(2)
  })

  it('logs a malformed response (not an ApiError) and does not cache it', async () => {
    const drift = new TypeError('planespotters: response has no photos array')
    h.planePhoto.mockRejectedValueOnce(drift)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(mod.fetchPlanePhoto('4b1814')).resolves.toBeNull()
    expect(log).toHaveBeenCalledWith(expect.any(String), drift)
    log.mockRestore()
  })
})
