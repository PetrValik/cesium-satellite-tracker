import type { WorldDecal } from '../../core/engine/WorldDecal'
import { OPS_MODES, useMode, type OpsMode } from '../../core/ui/modeStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import type { AircraftLayer } from '../../features/airspace/AircraftLayer'
import { useAircraft } from '../../features/airspace/aircraftStore'
import type { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import type { ShipsLayer } from '../../features/maritime/ShipsLayer'
import { useShips } from '../../features/maritime/shipsStore'
import type { TrackingVisuals } from '../../features/tracking/TrackingVisuals'
import { deselectInMode, resolveTap } from '../selectionMode'

/** Which domain's layer gets first claim on a tap: the focused mode's, then the others. */
const CLAIM_ORDER: Record<OpsMode, readonly OpsMode[]> = {
  orbital: ['orbital', 'maritime', 'airspace'],
  maritime: ['maritime', 'airspace', 'orbital'],
  airspace: ['airspace', 'maritime', 'orbital'],
}

/** Claim priority for a tap in `mode`; a cross-domain claim switches mode. */
export function claimOrder(mode: OpsMode): readonly OpsMode[] {
  return CLAIM_ORDER[mode]
}

/** What the router asks of the layers — structural, so tests pass fakes. */
interface TapTargets {
  constellation: Pick<ConstellationLayer, 'idOf'>
  tracking: Pick<TrackingVisuals, 'ownsMarker' | 'ownsThinDecoration'>
  ships: Pick<ShipsLayer, 'idOf'>
  shipDecal: Pick<WorldDecal, 'owns'>
  aircraft: Pick<AircraftLayer, 'idOf'>
  aircraftDecal: Pick<WorldDecal, 'owns'>
}

type Claimer = (hits: readonly unknown[]) => boolean

/**
 * A claimer walks the hits nearest-first and takes its layer's first
 * claim: it focuses that layer's mode and selects the object there.
 */
function claimer<Id>(
  idOf: (hit: unknown) => Id | null,
  mode: OpsMode,
  select: (id: Id) => void,
): Claimer {
  return (hits) => {
    for (const hit of hits) {
      const id = idOf(hit)
      if (id === null) continue
      useMode.getState().setMode(mode)
      select(id)
      return true
    }
    return false
  }
}

/**
 * What one globe tap does with its hits (nearest first): the first layer in
 * claim order that owns a hit selects it; otherwise a near-miss keeps the
 * selection and anything else is an empty tap that deselects in the mode.
 */
export function createTapRouter(t: TapTargets): (hits: readonly unknown[]) => void {
  // A hit on the selected object's own marker (tracked-satellite
  // billboard/label, ship/aircraft decal) counts as that object, so tapping
  // it keeps the selection instead of jumping to a neighbour.
  const claimers: Record<OpsMode, Claimer> = {
    orbital: claimer(
      (hit) =>
        t.tracking.ownsMarker(hit) ? useSatellites.getState().selectedId : t.constellation.idOf(hit),
      'orbital',
      (id) => useSatellites.getState().select(id),
    ),
    maritime: claimer(
      (hit) => (t.shipDecal.owns(hit) ? useShips.getState().selectedMmsi : t.ships.idOf(hit)),
      'maritime',
      (mmsi) => useShips.getState().select(mmsi),
    ),
    airspace: claimer(
      (hit) =>
        t.aircraftDecal.owns(hit) ? useAircraft.getState().selectedIcao : t.aircraft.idOf(hit),
      'airspace',
      (icao) => useAircraft.getState().select(icao),
    ),
  }
  const ordered = {} as Record<OpsMode, readonly Claimer[]>
  for (const mode of OPS_MODES) ordered[mode] = claimOrder(mode).map((d) => claimers[d])

  // Near-miss = a thin line of the selection an empty tap would drop
  // (ORBITAL: the tracked orbit ring / ground track) — keep it. Anything
  // else nobody claims (footprint fill, ports, launch sites, another
  // domain's lines) is an empty tap, as is no hit at all.
  const orbitalNearMiss = (hit: unknown) => t.tracking.ownsThinDecoration(hit)
  const noNearMiss = () => false

  return (hits) => {
    const mode = useMode.getState().mode
    const nearMiss = mode === 'orbital' ? orbitalNearMiss : noNearMiss
    if (resolveTap(hits, ordered[mode], nearMiss) === 'empty') deselectInMode(mode)
  }
}
