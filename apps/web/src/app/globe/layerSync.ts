import type { Viewer } from 'cesium'
import { setViewerBasemap } from '../../core/engine/createViewer'
import { isSimLive, simClock } from '../../core/sim/simClock'
import { isDomainVisible, OPS_MODES, transportVisible, useMode } from '../../core/ui/modeStore'
import { usePrefs } from '../../core/ui/prefsStore'
import type { AircraftLayer } from '../../features/airspace/AircraftLayer'
import { useAircraft, visibleAircraft } from '../../features/airspace/aircraftStore'
import { useCatalog } from '../../features/catalog/catalogStore'
import type { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import type { LaunchSitesLayer } from '../../features/infra/LaunchSitesLayer'
import type { PortsLayer } from '../../features/infra/PortsLayer'
import type { ShipsLayer } from '../../features/maritime/ShipsLayer'
import { useShips, visibleShips } from '../../features/maritime/shipsStore'
import type { SelectedSatellite } from '../../features/tracking/SelectedSatellite'
import { deselectInMode } from '../selectionMode'
import type { GlobeFollow } from './follow'

/** The globe's layers as the store wiring sees them — structural, so tests pass fakes. */
export interface SyncedLayers {
  viewer: Viewer
  constellation: Pick<ConstellationLayer, 'setVisible' | 'setPalette' | 'setSelected'>
  satellite: Pick<SelectedSatellite, 'select' | 'active'>
  ships: Pick<ShipsLayer, 'setShips' | 'setSelected' | 'setVisible' | 'setPalette'>
  aircraft: Pick<AircraftLayer, 'setAircraft' | 'setSelected' | 'setVisible' | 'setPalette'>
  launchSites: Pick<LaunchSitesLayer, 'setVisible'>
  ports: Pick<PortsLayer, 'setVisible'>
}

/**
 * Store → layer wiring: every zustand subscription that feeds, shows or
 * selects something on the globe (transient — no React re-renders). Also
 * the live-domain gate: ships and aircraft dead-reckon on WALL time, so
 * once the sim clock is warped, paused or scrubbed away from now their
 * positions are meaningless against the scene, and they suspend — hidden,
 * selection kept. All ships/aircraft visibility routes through that one
 * gate: (user layer toggle) AND (clock live).
 */
export class LayerSync {
  private readonly _layers: SyncedLayers
  private readonly _follow: GlobeFollow
  private _clockLive = isSimLive(simClock.get())
  private readonly _unsubs: (() => void)[] = []

  constructor(layers: SyncedLayers, follow: GlobeFollow) {
    this._layers = layers
    this._follow = follow
    const { viewer, constellation, ships, aircraft, launchSites, ports } = layers

    // A rebuild (or HMR) mounts with a selection already in the stores; the
    // subscriptions below only see changes, so apply it once here — before
    // applyPalettes() first feeds the layers, which then hide it.
    ships.setSelected(useShips.getState().selectedMmsi)
    aircraft.setSelected(useAircraft.getState().selectedIcao)

    this._applyLiveVisibility()
    const mode = useMode.getState()
    constellation.setVisible(isDomainVisible(mode, 'orbital'))
    launchSites.setVisible(mode.launchSites)
    ports.setVisible(mode.ports)

    // User palettes (persisted prefs); also the layers' first feed.
    this._applyPalettes()
    // The selected satellite, applied once for a rebuild like the live
    // domains above.
    const selectedId = useCatalog.getState().selectedId
    if (selectedId !== null) this._applySatellite(selectedId)

    // Subscriptions last: nothing after them can throw, so a failed build
    // never leaves one behind.
    this._unsubs.push(
      usePrefs.subscribe((state, prev) => {
        if (state.colors !== prev.colors) this._applyPalettes()
        if (state.basemap !== prev.basemap) setViewerBasemap(viewer, state.basemap)
      }),
      useShips.subscribe((state, prev) => {
        if (state.ships !== prev.ships || state.activeTypes !== prev.activeTypes) {
          ships.setShips(visibleShips(state))
        }
        if (state.selectedMmsi !== prev.selectedMmsi) {
          ships.setSelected(state.selectedMmsi)
          if (state.selectedMmsi !== null) follow.liveSelected()
          else follow.cleared('maritime')
        }
      }),
      useAircraft.subscribe((state, prev) => {
        if (
          state.aircraft !== prev.aircraft ||
          state.activeBands !== prev.activeBands ||
          state.activeCategories !== prev.activeCategories
        ) {
          aircraft.setAircraft(visibleAircraft(state))
        }
        if (state.selectedIcao !== prev.selectedIcao) {
          aircraft.setSelected(state.selectedIcao)
          if (state.selectedIcao !== null) follow.liveSelected()
          else follow.cleared('airspace')
        }
      }),
      useMode.subscribe((state, prev) => {
        if (state.launchSites !== prev.launchSites) launchSites.setVisible(state.launchSites)
        if (state.ports !== prev.ports) ports.setVisible(state.ports)
        for (const domain of OPS_MODES) {
          const visible = isDomainVisible(state, domain)
          if (visible === isDomainVisible(prev, domain)) continue
          if (domain === 'orbital') constellation.setVisible(visible)
          else this._applyLiveVisibility()
          // Hiding a layer with a selected (maybe followed) object would
          // leave a phantom selection — drop it; ORBITAL's tracking visuals
          // and telemetry go with it through the catalog subscription. User
          // toggles only: a warp-driven hide (_applyLiveVisibility) keeps
          // the selection alive.
          if (!visible) deselectInMode(domain)
        }
        // The transport bar unmounts with transportVisible. A clock left
        // warped/paused would keep the live feeds suspended with no visible
        // way back — snap it to real time instead.
        if (transportVisible(prev) && !transportVisible(state) && !isSimLive(simClock.get())) {
          simClock.get().resetToNow()
        }
      }),
      useCatalog.subscribe((state, prev) => {
        if (state.selectedId !== prev.selectedId) this._applySatellite(state.selectedId)
      }),
    )
  }

  /**
   * Per frame: liveness edge detection — a boolean compare, the live gate
   * re-applied only when it flips (warp engaged / back to NOW). Per-frame,
   * not event-driven, because a paused or suspended-tab clock drifts past
   * the epsilon without any store event. Returns the current liveness.
   */
  updateLiveness(): boolean {
    const liveNow = isSimLive(simClock.get())
    if (liveNow !== this._clockLive) {
      this._clockLive = liveNow
      this._applyLiveVisibility()
    }
    return liveNow
  }

  dispose(): void {
    for (const unsub of this._unsubs) unsub()
    this._unsubs.length = 0
  }

  /** The live-domain gate: user toggle AND clock live; the decals suspend with the clock. */
  private _applyLiveVisibility(): void {
    const mode = useMode.getState()
    this._layers.ships.setVisible(isDomainVisible(mode, 'maritime') && this._clockLive)
    this._layers.aircraft.setVisible(isDomainVisible(mode, 'airspace') && this._clockLive)
    // Their per-frame poses are skipped while not live. Deliberately NOT
    // clearing the selection here — unlike a user layer toggle, a warp-driven
    // hide must restore everything (selection, follow lock, decal) at NOW.
    if (!this._clockLive) this._follow.suspendDecals()
  }

  /** Push the palettes; the live layers tint at set time, so re-feed them to recolor. */
  private _applyPalettes(): void {
    const { colors } = usePrefs.getState()
    const { constellation, ships, aircraft } = this._layers
    aircraft.setPalette(colors.aircraft)
    ships.setPalette(colors.ships)
    constellation.setPalette(colors.satellites)
    aircraft.setAircraft(visibleAircraft(useAircraft.getState()))
    ships.setShips(visibleShips(useShips.getState()))
  }

  /** Point every satellite-domain consumer at `noradId` (null: deselect). */
  private _applySatellite(noradId: number | null): void {
    const { constellation, satellite } = this._layers
    const follow = this._follow
    constellation.setSelected(noradId)
    follow.dropSatellite()
    const sat = noradId === null ? undefined : useCatalog.getState().byId.get(noradId)
    const seed = satellite.select(sat ?? null, simClock.get().epochMs)
    if (noradId === null) {
      follow.cleared('orbital')
      return
    }
    // Unknown id or unusable TLE: nothing to track or follow.
    if (!satellite.active) return
    // Seed the follow target now: satelliteSelected() below (and a lock
    // resumed after a rebuild) engages before the next frame would, and
    // must size the range for THIS satellite, not the previous one.
    if (seed) follow.holdSatellite(seed)
    follow.satelliteSelected()
  }
}
