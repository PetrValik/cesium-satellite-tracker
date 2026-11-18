import type { CameraRig } from '../../core/engine/CameraRig'
import { bindCameraHandler, type CameraCommand } from '../../core/ui/cameraStore'
import { useFollow } from '../../core/ui/followStore'

/** The rig surface the navigation commands drive — structural, so tests pass fakes. */
export type NavRig = Pick<CameraRig, 'flyHome' | 'flyTo' | 'zoomStep' | 'levelNorth'>

/** Drop the follow lock through its intent store; GlobeFollow unfollows the rig synchronously. */
function releaseFollow(): void {
  if (useFollow.getState().following) useFollow.getState().setFollowing(false)
}

/**
 * Run one HUD / key camera command on the rig. HOME and locate (`flyTo`)
 * release the follow lock FIRST, then fly: the other order would let
 * `unfollow()`'s `cancelFlight()` kill the new flight. Level and zoom keep
 * the lock (the rig levels / zooms inside the follow frame).
 */
export function runCameraCommand(rig: NavRig, command: CameraCommand): void {
  switch (command.kind) {
    case 'home':
      releaseFollow()
      rig.flyHome()
      return
    case 'flyTo':
      releaseFollow()
      rig.flyTo(command.lonDeg, command.latDeg, command.heightM)
      return
    case 'level':
      rig.levelNorth()
      return
    case 'zoom':
      rig.zoomStep(command.direction)
      return
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}

/**
 * Bind this globe as the camera command handler. The returned unbind goes on
 * the globe's teardown; it clears the slot only while it still holds this
 * globe's handler, so an old globe's late teardown cannot unbind a rebuilt one.
 */
export function bindCameraCommands(rig: NavRig): () => void {
  return bindCameraHandler((command) => runCameraCommand(rig, command))
}
