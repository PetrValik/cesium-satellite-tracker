import { create } from 'zustand'

/**
 * Wall-clock time at coarse resolution, safe to read during render
 * (unlike Date.now()). Used for TLE age and scrub-offset display —
 * quantities anchored to real time, not sim time.
 */
export const useWallClock = create<{ nowMs: number }>(() => ({ nowMs: Date.now() }))

const RESOLUTION_MS = 10_000

setInterval(() => useWallClock.setState({ nowMs: Date.now() }), RESOLUTION_MS)
