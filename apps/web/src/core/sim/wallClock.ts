import { create } from 'zustand'

/**
 * Wall-clock time at coarse resolution, safe to read during render
 * (unlike Date.now()). The real-time twin of the sim clock: everything
 * anchored to real time rather than sim time reads it — TLE age, the
 * scrub offset, vessel and aircraft report age, AIR data age, and
 * `simLive`'s liveness re-check. The interval starts on first import and
 * runs for the page's lifetime.
 */
export const useWallClock = create<{ nowMs: number }>(() => ({ nowMs: Date.now() }))

const RESOLUTION_MS = 10_000

setInterval(() => useWallClock.setState({ nowMs: Date.now() }), RESOLUTION_MS)
