import { useFollow } from './followStore'

/** Camera follow-lock toggle shown in every selection panel header. */
export function FollowButton() {
  const following = useFollow((s) => s.following)
  const toggle = useFollow((s) => s.toggle)
  return (
    <button
      className={`hud-button${following ? ' is-active' : ''}`}
      onClick={toggle}
      title="Camera follow-lock (F)"
    >
      ⌖ {following ? 'LOCKED' : 'FOLLOW'}
    </button>
  )
}
