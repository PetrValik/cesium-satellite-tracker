import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

/** Stub global fetch with one canned response. */
function stubFetch(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api.planePhoto', () => {
  const photo = {
    id: '1',
    thumbnail: { src: 'https://t.plnspttrs.net/small.jpg' },
    thumbnail_large: { src: 'https://t.plnspttrs.net/large.jpg' },
    link: 'https://www.planespotters.net/photo/1',
    photographer: 'A. Spotter',
  }

  it('requests the airframe by hex and returns the first photo, large thumbnail first', async () => {
    const fetchMock = stubFetch({ photos: [photo, { ...photo, id: '2' }] })
    await expect(api.planePhoto('4b1814')).resolves.toEqual({
      thumbUrl: 'https://t.plnspttrs.net/large.jpg',
      link: 'https://www.planespotters.net/photo/1',
      photographer: 'A. Spotter',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.planespotters.net/pub/photos/hex/4b1814')
  })

  it('falls back to the small thumbnail and a null photographer', async () => {
    stubFetch({ photos: [{ ...photo, thumbnail_large: undefined, photographer: undefined }] })
    await expect(api.planePhoto('4b1814')).resolves.toEqual({
      thumbUrl: 'https://t.plnspttrs.net/small.jpg',
      link: 'https://www.planespotters.net/photo/1',
      photographer: null,
    })
  })

  it('is null when no photo is listed or the first one is unusable', async () => {
    stubFetch({ photos: [] })
    await expect(api.planePhoto('4b1814')).resolves.toBeNull()
    stubFetch({ photos: [{ ...photo, link: undefined }] })
    await expect(api.planePhoto('4b1814')).resolves.toBeNull()
    stubFetch({ photos: [{ ...photo, thumbnail: undefined, thumbnail_large: undefined }] })
    await expect(api.planePhoto('4b1814')).resolves.toBeNull()
  })

  it('throws (not ApiError) when the body has no photos array — shape drift', async () => {
    stubFetch({ error: 'changed' })
    const err = await api.planePhoto('4b1814').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(ApiError)
  })

  it('throws ApiError with the status for a non-ok answer', async () => {
    stubFetch({}, { status: 429, statusText: 'Too Many Requests' })
    await expect(api.planePhoto('4b1814')).rejects.toMatchObject({ name: 'ApiError', status: 429 })
  })

  it('throws ApiError with a null status when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(api.planePhoto('4b1814')).rejects.toMatchObject({ name: 'ApiError', status: null })
  })
})

describe('api (own API)', () => {
  it('prefixes /api and reports a 503 as ApiError with its JSON error detail', async () => {
    const fetchMock = stubFetch({ error: 'AIS feed not configured' }, { status: 503 })
    await expect(api.ships()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'AIS feed not configured',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/ships')
  })
})
