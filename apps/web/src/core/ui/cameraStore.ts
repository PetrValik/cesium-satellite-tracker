import { create } from 'zustand'

/**
 * Globe navigation, HUD side. The HUD buttons (app/NavControls) and the
 * globe keys request camera commands here; `app/globe/cameraCommands` is the
 * only handler, and it drives `core/engine/CameraRig`. The frame loop
 * publishes the camera heading for the compass.
 *
 * Commands are events, not state: they go through a plain module-level
 * handler slot, never a store, so a command requested while no globe is
 * bound is dropped instead of replaying into a rebuilt globe.
 */
export type CameraCommand =
  | { kind: 'home' }
  | { kind: 'level' }
  | { kind: 'zoom'; direction: 1 | -1 }
  | { kind: 'flyTo'; lonDeg: number; latDeg: number; heightM: number }

let handler: ((command: CameraCommand) => void) | null = null

/** Hand `command` to the bound globe, once and synchronously; dropped while none is bound. */
export function requestCamera(command: CameraCommand): void {
  handler?.(command)
}

/**
 * Bind the globe's command handler (one slot: a newer binding replaces the
 * old). The returned unbind clears the slot only while it still holds this
 * handler, so an old globe's late teardown after a context-loss rebuild
 * cannot unbind the new globe.
 */
export function bindCameraHandler(next: (command: CameraCommand) => void): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/** The compass re-renders only on a heading change of at least this much. */
export const HEADING_STEP_DEG = 1

/** Whether two headings differ by at least HEADING_STEP_DEG, measured the short way round. */
export function headingMoved(prevDeg: number, nextDeg: number): boolean {
  return Math.abs(((((nextDeg - prevDeg) % 360) + 540) % 360) - 180) >= HEADING_STEP_DEG
}

/** Camera heading for the compass, in degrees clockwise from north. */
export const useCameraHeading = create<{ headingDeg: number }>(() => ({ headingDeg: 0 }))

/**
 * Called by the frame loop every frame: one number compare, and a store set
 * (a React render) only when the heading moved at least HEADING_STEP_DEG.
 */
export function publishHeading(headingDeg: number): void {
  if (headingMoved(useCameraHeading.getState().headingDeg, headingDeg)) {
    useCameraHeading.setState({ headingDeg })
  }
}
