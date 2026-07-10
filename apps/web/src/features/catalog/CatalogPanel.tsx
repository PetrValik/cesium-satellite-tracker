import { useEffect, useRef, useState } from 'react'
import type { Satellite } from '@orbital-ops/shared'
import { api } from '../../lib/api'
import { formatCount } from '../../lib/format'
import { useCatalog } from './catalogStore'

export function CatalogPanel() {
  const groups = useCatalog((s) => s.groups)
  const activeSlugs = useCatalog((s) => s.activeSlugs)
  const loadingGroups = useCatalog((s) => s.loadingGroups)
  const toggleGroup = useCatalog((s) => s.toggleGroup)

  return (
    <section className="hud-panel catalog-panel">
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
    </section>
  )
}

function SearchBox() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Satellite[]>([])
  const [open, setOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined)
  const registerSat = useCatalog((s) => s.registerSat)
  const select = useCatalog((s) => s.select)

  useEffect(() => () => clearTimeout(debounce.current), [])

  const onChange = (value: string) => {
    setQ(value)
    clearTimeout(debounce.current)
    if (value.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    debounce.current = setTimeout(() => {
      api
        .search(value.trim())
        .then((sats) => {
          setResults(sats)
          setOpen(true)
        })
        .catch(() => setResults([]))
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
