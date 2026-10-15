import { Cartesian3 } from 'cesium'
import type { Aircraft, Ship } from '@orbital-ops/shared'
import type { CameraRig } from '../../core/engine/CameraRig'
import type { WorldDecal } from '../../core/engine/WorldDecal'
import { useFollow } from '../../core/ui/followStore'
import { useMode, type OpsMode } from '../../core/ui/modeStore'
import { aircraftPositionAt, type AircraftPosition } from '../../features/airspace/aircraftMotion'
import { useAircraft } from '../../features/airspace/aircraftStore'
import {
  shipBearingDeg,
  shipPositionAt,
  type ShipPosition,
} from '../../features/maritime/shipMotion'
import { useShips } from '../../features/maritime/shipsStore'
import type { SatStateEcef } from '../../lib/orbital'
import { hasSelectionInMode } from '../selectionMode'

/**
 * Lowest altitude the selected ship/aircraft decal is drawn at — a height-0
 * quad z-fights the globe (depthTestAgainstTerrain). The follow camera
 * targets the very same point, so camera and decal never disagree.
 */
const DECAL_MIN_ALT_M = 50
/** The orbital follow range is sized from this until a satellite's altitude is known. */
const DEFAULT_FOLLOW_ALT_KM = 400
/** Initial follow range on a selected ship / aircraft. */
const SHIP_FOLLOW_RANGE_M = 60_000
const AIRCRAFT_FOLLOW_RANGE_M = 120_000

/** Initial orbital follow range: three times the altitude, between 150 km and 80 000 km. */
export function orbitalFollowRangeM(altKm: number): number {
  return Math.min(Math.max(altKm * 3000, 150_000), 80_000_000)
}

/**
 * Whether clearing `cleared`'s selection releases a lock riding `followed`.
 * The FOLLOWED domain decides, never the focused mode: hiding a domain from
 * LAYERS (or its tab) refocuses `mode` in the same store update that clears
 * the selection, so a mode-gated release would leave the camera parked on a
 * target that no longer exists, still reading LOCKED.
 */
export function releasesFollow(followed: OpsMode | null, cleared: OpsMode): boolean {
  return followed !== null && followed === cleared
}

/** The surfaces driven here — structural, so tests pass fakes. */
type FollowRig = Pick<CameraRig, 'follow' | 'unfollow'>
type FollowDecal = Pick<WorldDecal, 'setPose' | 'hide'>

/**
 * The camera follow lock (non-React): which domain's selection the rig
 * rides, where that object is right now, and the selected ship/aircraft
 * decals posed at exactly that point. `useFollow.following` is the intent;
 * this executes it.
 */
export class GlobeFollow {
  private readonly _rig: FollowRig
  private readonly _satellite: { readonly active: boolean }
  private readonly _shipDecal: FollowDecal
  private readonly _aircraftDecal: FollowDecal
  /** The domain whose selection the rig is locked onto (null: free camera). */
  private _followed: OpsMode | null = null
  /** Orbital target: the selected satellite's last propagated position. */
  private readonly _satPos = new Cartesian3()
  private _satValid = false
  private _satAltKm = DEFAULT_FOLLOW_ALT_KM
  /** Scratch for the ship/aircraft target, returned by reference. */
  private readonly _liveTarget = new Cartesian3()
  private readonly _shipPos: ShipPosition = { latDeg: 0, lonDeg: 0 }
  private readonly _aircraftPos: AircraftPosition = { latDeg: 0, lonDeg: 0, altM: 0 }
  private readonly _unsubFollow: () => void

  constructor(
    rig: FollowRig,
    satellite: { readonly active: boolean },
    shipDecal: FollowDecal,
    aircraftDecal: FollowDecal,
  ) {
    this._rig = rig
    this._satellite = satellite
    this._shipDecal = shipDecal
    this._aircraftDecal = aircraftDecal
    this._unsubFollow = useFollow.subscribe((state, prev) => {
      if (state.following === prev.following) return
      if (state.following) this._engage()
      else {
        this._followed = null
        this._rig.unfollow()
      }
    })
  }

  /** Point the rig at the focused mode's selection (idempotent); none there drops the lock. */
  private _engage(): void {
    const mode = useMode.getState().mode
    if (mode === 'orbital') {
      if (!this._satellite.active) {
        useFollow.getState().setFollowing(false)
        return
      }
      this._rig.follow(
        () => (this._satValid ? this._satPos : null),
        orbitalFollowRangeM(this._satAltKm),
      )
    } else if (mode === 'maritime') {
      if (useShips.getState().selectedMmsi === null) {
        useFollow.getState().setFollowing(false)
        return
      }
      this._rig.follow(this._shipTarget, SHIP_FOLLOW_RANGE_M)
    } else {
      if (useAircraft.getState().selectedIcao === null) {
        useFollow.getState().setFollowing(false)
        return
      }
      this._rig.follow(this._aircraftTarget, AIRCRAFT_FOLLOW_RANGE_M)
    }
    this._followed = mode
  }

  /**
   * A ship or aircraft was picked: lock the camera onto it (the ask: click →
   * fly & ride). A fresh lock engages through the follow subscription; an
   * existing one is re-pointed here — never both (one fly-in, not two).
   */
  liveSelected(): void {
    if (useFollow.getState().following) this._engage()
    else useFollow.getState().setFollowing(true)
  }

  /** A newly tracked satellite: carry a lock on the previous one over (ORBITAL focus only). */
  satelliteSelected(): void {
    if (useFollow.getState().following && useMode.getState().mode === 'orbital') this._engage()
  }

  /** `domain`'s selection cleared: hide its decal, and release the lock if it rode that domain. */
  cleared(domain: OpsMode): void {
    if (domain === 'maritime') this._shipDecal.hide()
    else if (domain === 'airspace') this._aircraftDecal.hide()
    if (releasesFollow(this._followed, domain)) useFollow.getState().setFollowing(false)
  }

  /** Hold a propagated state as the orbital follow target and range basis. */
  holdSatellite(state: Readonly<SatStateEcef>): void {
    this._satPos.x = state.positionEcefM[0]
    this._satPos.y = state.positionEcefM[1]
    this._satPos.z = state.positionEcefM[2]
    this._satValid = true
    this._satAltKm = state.altKm
  }

  /** Forget the previous satellite's target before a new selection is applied. */
  dropSatellite(): void {
    this._satValid = false
    this._satAltKm = DEFAULT_FOLLOW_ALT_KM
  }

  /**
   * Per frame, live clock only: the selected ship/aircraft decals at the
   * same dead-reckoned point the follow camera targets, world-oriented —
   * ship bow along shipBearingDeg, falling back to COG because the decal
   * always needs some bearing, even for a headingless moored ship; aircraft
   * nose along track, north when none — screen-proportional size.
   */
  poseDecals(wallNowMs: number, cameraPosition: Cartesian3): void {
    const ship = this._poseShip(wallNowMs)
    if (ship) {
      this._shipDecal.setPose(
        this._shipPos.lonDeg,
        this._shipPos.latDeg,
        DECAL_MIN_ALT_M,
        shipBearingDeg(ship) ?? ship.cogDeg,
        cameraPosition,
      )
    }
    const aircraft = this._poseAircraft(wallNowMs)
    if (aircraft) {
      this._aircraftDecal.setPose(
        this._aircraftPos.lonDeg,
        this._aircraftPos.latDeg,
        this._aircraftPos.altM,
        aircraft.trackDeg ?? 0,
        cameraPosition,
      )
    }
  }

  /**
   * Hide both decals while the sim clock is not live. The selection and the
   * lock stay: a warp-driven hide restores everything when time returns to
   * NOW, and the next poseDecals re-shows them.
   */
  suspendDecals(): void {
    this._shipDecal.hide()
    this._aircraftDecal.hide()
  }

  /** After a rebuild: re-engage the lock the lost renderer interrupted. */
  resume(): void {
    if (hasSelectionInMode()) useFollow.getState().setFollowing(true)
  }

  /** Releases the lock (the rig unfollows) before unsubscribing. */
  dispose(): void {
    useFollow.getState().setFollowing(false)
    this._unsubFollow()
  }

  /**
   * The selected ship dead-reckoned to `wallNowMs` into `_shipPos` — the
   * slice's own motion rule, the one its layer uses — or undefined when
   * none is selected.
   */
  private _poseShip(wallNowMs: number): Ship | undefined {
    const st = useShips.getState()
    const ship = st.selectedMmsi === null ? undefined : st.byMmsi.get(st.selectedMmsi)
    if (ship) shipPositionAt(ship, wallNowMs, this._shipPos)
    return ship
  }

  /** Same for the selected aircraft into `_aircraftPos`, lifted to DECAL_MIN_ALT_M. */
  private _poseAircraft(wallNowMs: number): Aircraft | undefined {
    const st = useAircraft.getState()
    const a = st.selectedIcao === null ? undefined : st.byIcao.get(st.selectedIcao)
    if (a) {
      aircraftPositionAt(a, wallNowMs, this._aircraftPos)
      this._aircraftPos.altM = Math.max(DECAL_MIN_ALT_M, this._aircraftPos.altM)
    }
    return a
  }

  /** Follow target: exactly the point the selected ship's decal occupies. */
  private readonly _shipTarget = (): Cartesian3 | null =>
    this._poseShip(Date.now()) === undefined
      ? null
      : Cartesian3.fromDegrees(
          this._shipPos.lonDeg,
          this._shipPos.latDeg,
          DECAL_MIN_ALT_M,
          undefined,
          this._liveTarget,
        )

  /** Follow target: exactly the point the selected aircraft's decal occupies. */
  private readonly _aircraftTarget = (): Cartesian3 | null =>
    this._poseAircraft(Date.now()) === undefined
      ? null
      : Cartesian3.fromDegrees(
          this._aircraftPos.lonDeg,
          this._aircraftPos.latDeg,
          this._aircraftPos.altM,
          undefined,
          this._liveTarget,
        )
}
