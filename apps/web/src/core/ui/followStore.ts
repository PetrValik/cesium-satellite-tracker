import { create } from 'zustand'

/**
 * Follow-lock intent: when true, the camera rides the current mode's
 * selection (GlobeView owns the execution). Flipped by the F key, the
 * FOLLOW buttons, and automatically when a ship/aircraft is selected.
 */
export interface FollowState {
  following: boolean
  setFollowing: (following: boolean) => void
  toggle: () => void
}

export const useFollow = create<FollowState>((set) => ({
  following: false,
  setFollowing: (following) => set({ following }),
  toggle: () => set((s) => ({ following: !s.following })),
}))
