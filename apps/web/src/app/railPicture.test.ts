import { describe, expect, it, vi } from 'vitest'

// The pictures are React panels whose stores poll and tick; the rules only need their identity.
vi.mock('../features/catalog/CatalogPanel', () => ({ CatalogPanel: () => null }))
vi.mock('../features/maritime/MaritimePicture', () => ({ MaritimePicture: () => null }))
vi.mock('../features/airspace/AirPicture', () => ({ AirPicture: () => null }))

import { legendCount, legendSections, pictureDockLabel, visiblePictures } from './railPicture'

const ALL_ON = { satellitesVisible: true, shipsVisible: true, aircraftVisible: true }
const [catalog, vessels, aircraft] = visiblePictures(ALL_ON)
const UNFOLDED = { orbital: false, maritime: false, airspace: false }

describe('visiblePictures', () => {
  it('lists every visible domain in tab order', () => {
    expect(visiblePictures(ALL_ON).map((p) => [p.mode, p.label])).toEqual([
      ['orbital', 'CATALOG'], ['maritime', 'VESSELS'], ['airspace', 'AIRCRAFT'],
    ])
  })
  it('skips hidden domains and keeps the order', () => {
    expect(visiblePictures({ ...ALL_ON, satellitesVisible: false }).map((p) => p.mode))
      .toEqual(['maritime', 'airspace'])
    expect(visiblePictures({ satellitesVisible: false, shipsVisible: false, aircraftVisible: false }))
      .toEqual([])
  })
  it('hands out the same entry objects every call (useShallow relies on it)', () => {
    const again = visiblePictures(ALL_ON)
    expect(again[0]).toBe(catalog)
    expect(again[1]).toBe(vessels)
    expect(again[2]).toBe(aircraft)
  })
})

describe('pictureDockLabel', () => {
  it('is null with no domain on', () => expect(pictureDockLabel([])).toBeNull())
  it('is the domain’s name with one on', () => expect(pictureDockLabel([vessels])).toBe('VESSELS'))
  it('is LEGEND with two or more on', () => {
    expect(pictureDockLabel([catalog, aircraft])).toBe('LEGEND')
    expect(pictureDockLabel([catalog, vessels, aircraft])).toBe('LEGEND')
  })
})

describe('legendSections', () => {
  it('a lone section cannot fold, even with a stored fold', () => {
    expect(legendSections([catalog], { ...UNFOLDED, orbital: true }))
      .toEqual([{ entry: catalog, foldable: false, folded: false }])
  })
  it('stacked sections fold per domain', () => {
    expect(legendSections([catalog, vessels], { orbital: true, maritime: false, airspace: true })).toEqual([
      { entry: catalog, foldable: true, folded: true },
      { entry: vessels, foldable: true, folded: false },
    ])
  })
})

describe('legendCount', () => {
  const counts = { orbital: 12_408, maritime: 3_120, airspace: 0 }
  it('is the formatted live count', () => {
    expect(legendCount('orbital', counts, true)).toBe('12 408')
    expect(legendCount('airspace', counts, true)).toBe('0')
  })
  it('reads SUSP for the live feeds while sim time is off NOW', () => {
    expect(legendCount('maritime', counts, false)).toBe('SUSP')
    expect(legendCount('airspace', counts, false)).toBe('SUSP')
  })
  it('never suspends satellites, which move in sim time', () => {
    expect(legendCount('orbital', counts, false)).toBe('12 408')
  })
})
