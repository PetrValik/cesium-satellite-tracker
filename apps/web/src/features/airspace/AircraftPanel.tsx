import { useEffect, useState } from 'react'
import type { Aircraft } from '@orbital-ops/shared'
import { FollowButton } from '../../core/ui/FollowButton'
import { hueStyle } from '../../core/ui/hueStyle'
import { usePrefs } from '../../core/ui/prefsStore'
import { useWallClock } from '../../core/sim/wallClock'
import { formatAge, formatDeg, formatLatLon } from '../../lib/format'
import { categoryOf } from './aircraftCategory'
import { useAircraft } from './aircraftStore'
import { aircraftName, formatAircraftAlt } from './aircraftSummary'
import { fetchPlanePhoto, type PlanePhoto } from './planePhotos'

const MS_TO_KN = 1.94384

/** Airframe photo with the attribution planespotters.net requires. */
function PhotoCard({ icao24 }: { icao24: string }) {
  // Tag the fetched photo with its airframe so a stale result — or the previous
  // aircraft's photo — never renders while a new fetch is in flight.
  // photo null = no photo for this airframe.
  const [loaded, setLoaded] = useState<{ icao24: string; photo: PlanePhoto | null } | null>(null)

  useEffect(() => {
    let alive = true
    void fetchPlanePhoto(icao24).then((result) => {
      if (alive) setLoaded({ icao24, photo: result })
    })
    return () => {
      alive = false
    }
  }, [icao24])

  const photo = loaded?.icao24 === icao24 ? loaded.photo : null
  if (!photo) return null
  return (
    <figure className="photo-card">
      <a href={photo.link} target="_blank" rel="noreferrer noopener">
        <img src={photo.thumbUrl} alt="Aircraft photo" loading="lazy" />
      </a>
      <figcaption>
        © {photo.photographer} ·{' '}
        <a href={photo.link} target="_blank" rel="noreferrer noopener">
          Planespotters.net
        </a>
      </figcaption>
    </figure>
  )
}

/** CATEGORY value, in the hue the globe paints that category with (user palette). */
function CategoryValue({ aircraft }: { aircraft: Aircraft }) {
  const category = categoryOf(aircraft)
  const color = usePrefs((s) => s.colors.aircraft[category])
  return (
    <dd className="hue-text" style={hueStyle(color)}>
      {category.toUpperCase()}
    </dd>
  )
}

/** Info panel for the selected aircraft (live ADS-B data, wall-clock based). */
export function AircraftPanel() {
  const selectedIcao = useAircraft((s) => s.selectedIcao)
  const aircraft = useAircraft((s) =>
    s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao),
  )
  const select = useAircraft((s) => s.select)
  const nowMs = useWallClock((s) => s.nowMs)

  if (selectedIcao === null) return null

  return (
    // telemetry-panel: a rule-less hook shared by the three selection panels
    <section className="hud-panel telemetry-panel">
      <header className="telemetry-header">
        <h2 className="hud-title">AIRCRAFT</h2>
        <span className="panel-actions">
          <FollowButton />
          <button className="hud-button" onClick={() => select(null)} title="Deselect (Esc)">
            ✕
          </button>
        </span>
      </header>
      <div className="telemetry-name">{aircraftName(aircraft, selectedIcao)}</div>
      <PhotoCard icao24={selectedIcao} />
      {aircraft ? (
        <dl className="telemetry-grid">
          <dt>ICAO24</dt>
          <dd>{aircraft.icao24.toUpperCase()}</dd>
          <dt>CATEGORY</dt>
          <CategoryValue aircraft={aircraft} />
          <dt>ALT</dt>
          <dd>{formatAircraftAlt(aircraft)}</dd>
          <dt>GS</dt>
          <dd>{aircraft.velocityMs === null ? '—' : `${Math.round(aircraft.velocityMs * MS_TO_KN)} KN`}</dd>
          <dt>TRK</dt>
          <dd>{aircraft.trackDeg === null ? '—' : formatDeg(aircraft.trackDeg, 0)}</dd>
          <dt>V/S</dt>
          <dd>
            {aircraft.verticalRateMs === null ? '—' : `${aircraft.verticalRateMs > 0 ? '+' : ''}${aircraft.verticalRateMs.toFixed(1)} M/S`}
          </dd>
          <dt>POS</dt>
          <dd>{formatLatLon(aircraft.latDeg, aircraft.lonDeg)}</dd>
          <dt>REPORT</dt>
          <dd>{formatAge(Math.max(0, nowMs - aircraft.tsMs))} AGO</dd>
        </dl>
      ) : (
        <div className="panel-empty">SIGNAL LOST — AIRCRAFT AGED OUT OF THE FEED</div>
      )}
    </section>
  )
}
