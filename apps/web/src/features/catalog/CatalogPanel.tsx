import { useEffect, useRef, useState } from 'react'
import type { Satellite, ShipType } from '@orbital-ops/shared'
import { api } from '../../lib/api'
import { formatAge, formatCount } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'
import { useMode } from '../../core/ui/modeStore'
import { useAircraft } from '../airspace/aircraftStore'
import { useShips } from '../maritime/shipsStore'
import launchSites from '../../data/launchSites.json'
import ports from '../../data/ports.json'
import { useCatalog } from './catalogStore'

export function CatalogPanel() {
  const mode = useMode((s) => s.mode)
  return (
    <section className="hud-panel catalog-panel">
      {mode === 'orbital' && <OrbitalCatalog />}
      {mode === 'maritime' && <MaritimeCatalog />}
      {mode === 'airspace' && <AirspaceCatalog />}
      <InfraSection />
    </section>
  )
}

function OrbitalCatalog() {
  const groups = useCatalog((s) => s.groups)
  const activeSlugs = useCatalog((s) => s.activeSlugs)
  const loadingGroups = useCatalog((s) => s.loadingGroups)
  const toggleGroup = useCatalog((s) => s.toggleGroup)

  return (
    <>
      <h2 className="hud-title">CATALOG</h2>
      <SearchBox />
      <ul className="group-list">
        {groups.map((g) => {
          const active = activeSlugs.includes(g.slug)
          const loading = loadingGroups.has(g.slug)
          return (
            <li key={g.slug}>
              <button
                className={`group-row${active ? ' is-active' : ''}`}
                onClick={() => void toggleGroup(g.slug)}
                disabled={loading}
              >
                <span className="group-indicator" aria-hidden />
                <span className="group-name">{g.name.toUpperCase()}</span>
                <span className="group-count">
                  {loading ? '…' : formatCount(g.count)}
                  {g.stale ? <span className="stale-dot" title="TLE data stale" /> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

const SHIP_TYPE_ORDER: { type: ShipType; label: string }[] = [
  { type: 'cargo', label: 'CARGO' },
  { type: 'tanker', label: 'TANKER' },
  { type: 'passenger', label: 'PASSENGER' },
  { type: 'fishing', label: 'FISHING' },
  { type: 'highspeed', label: 'HIGH-SPEED' },
  { type: 'other', label: 'OTHER' },
]

function MaritimeCatalog() {
  const configured = useShips((s) => s.configured)
  const countsByType = useShips((s) => s.countsByType)
  const total = useShips((s) => s.ships.length)

  return (
    <>
      <h2 className="hud-title">MARITIME PICTURE</h2>
      {configured === false && (
        <div className="passes-empty">
          AIS OFFLINE — REGISTER AT AISSTREAM.IO AND SET AISSTREAM_API_KEY FOR THE API
        </div>
      )}
      {configured === null && <div className="passes-empty">CONNECTING…</div>}
      {configured === true && (
        <>
          <div className="live-count">{formatCount(total)} VESSELS LIVE</div>
          <ul className="group-list">
            {SHIP_TYPE_ORDER.map(({ type, label }) => (
              <li key={type}>
                <div className="group-row is-active">
                  <span className={`group-indicator ship-${type}`} aria-hidden />
                  <span className="group-name">{label}</span>
                  <span className="group-count">{formatCount(countsByType[type] ?? 0)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function AirspaceCatalog() {
  const available = useAircraft((s) => s.available)
  const total = useAircraft((s) => s.aircraft.length)
  const lastPollMs = useAircraft((s) => s.lastPollMs)
  const nowMs = useWallClock((s) => s.nowMs)

  return (
    <>
      <h2 className="hud-title">AIR PICTURE</h2>
      {available === false && (
        <div className="passes-empty">
          ADS-B OFFLINE — OPENSKY UNREACHABLE (OPTIONAL OPENSKY_CLIENT_ID SPEEDS UP POLLING)
        </div>
      )}
      {available === null && <div className="passes-empty">CONNECTING…</div>}
      {available === true && (
        <>
          <div className="live-count">{formatCount(total)} AIRCRAFT LIVE</div>
          {lastPollMs !== null && (
            <div className="live-meta">DATA AGE {formatAge(Math.max(0, nowMs - lastPollMs))}</div>
          )}
        </>
      )}
    </>
  )
}

function InfraSection() {
  const launchSitesOn = useMode((s) => s.launchSites)
  const portsOn = useMode((s) => s.ports)
  const toggleLaunchSites = useMode((s) => s.toggleLaunchSites)
  const togglePorts = useMode((s) => s.togglePorts)

  return (
    <>
      <h2 className="hud-title infra-title">INFRA</h2>
      <ul className="group-list">
        <li>
          <button
            className={`group-row${launchSitesOn ? ' is-active' : ''}`}
            onClick={toggleLaunchSites}
          >
            <span className="group-indicator" aria-hidden />
            <span className="group-name">LAUNCH SITES</span>
            <span className="group-count">{launchSites.length}</span>
          </button>
        </li>
        <li>
          <button className={`group-row${portsOn ? ' is-active' : ''}`} onClick={togglePorts}>
            <span className="group-indicator infra-port" aria-hidden />
            <span className="group-name">MAJOR PORTS</span>
            <span className="group-count">{ports.length}</span>
          </button>
        </li>
      </ul>
    </>
  )
}

function SearchBox() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Satellite[]>([])
  const [open, setOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Monotonic request id: a slow early response must not overwrite a later one.
  const searchSeq = useRef(0)
  const registerSat = useCatalog((s) => s.registerSat)
  const select = useCatalog((s) => s.select)

  useEffect(() => () => clearTimeout(debounce.current), [])

  const onChange = (value: string) => {
    setQ(value)
    clearTimeout(debounce.current)
    if (value.trim().length < 2) {
      searchSeq.current++
      setResults([])
      setOpen(false)
      return
    }
    debounce.current = setTimeout(() => {
      const seq = ++searchSeq.current
      api
        .search(value.trim())
        .then((sats) => {
          if (seq !== searchSeq.current) return // stale response
          setResults(sats)
          setOpen(true)
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([])
        })
    }, 250)
  }

  const pick = (sat: Satellite) => {
    registerSat(sat)
    select(sat.noradId)
    setOpen(false)
    setQ(sat.name)
  }

  return (
    <div className="search-box">
      <input
        className="hud-input"
        placeholder="SEARCH NAME / NORAD ID"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        spellCheck={false}
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((sat) => (
            <li key={sat.noradId}>
              <button className="search-result" onClick={() => pick(sat)}>
                <span>{sat.name}</span>
                <span className="search-norad">{sat.noradId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
