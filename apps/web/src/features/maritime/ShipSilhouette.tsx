import type { ShipType } from '@orbital-ops/shared'

/**
 * HUD-style side-profile silhouette, one per vessel class. Stands in for a
 * photo — there is no free vessel-photo API — so the panel gets a drawn
 * "recognition profile" instead, in the app's outline/beam-line style.
 *
 * Conventions: bow faces right, shared 120×44 viewBox, waterline at y=34.
 * All strokes inherit color from CSS (`currentColor` + token classes in
 * index.css) — no hex values here.
 */

/** Per-class profile artwork (hull + the class's telltale superstructure). */
function Profile({ type }: { type: ShipType }) {
  switch (type) {
    case 'cargo':
      // Container ship: aft bridge block, container stacks along the deck.
      return (
        <g>
          <path className="sil-hull" d="M8 24 H104 L114 32 L110 39 H10 Z" />
          <path className="sil-hull" d="M14 24 V8 H28 V24 Z" />
          <path d="M32 24 V14 H98 V24" />
          <path
            className="sil-detail"
            d="M43 14 V24 M54 14 V24 M65 14 V24 M76 14 V24 M87 14 V24 M32 19 H98"
          />
        </g>
      )
    case 'tanker':
      // Low flat deck, small aft house, midship manifold pipes + catwalk.
      return (
        <g>
          <path className="sil-hull" d="M8 26 H104 L114 33 L110 39 H10 Z" />
          <path className="sil-hull" d="M13 26 V13 H26 V26 Z" />
          <path className="sil-detail" d="M30 22 H96" />
          <path d="M56 26 V16 M62 26 V16 M50 19 H68" />
          <path className="sil-detail" d="M96 26 V22 H105" />
        </g>
      )
    case 'passenger':
      // Cruise liner: superstructure nearly hull-length, stacked deck rows.
      return (
        <g>
          <path className="sil-hull" d="M8 27 H106 L114 33 L110 39 H10 Z" />
          <path className="sil-hull" d="M14 27 V10 L22 8 H86 L98 15 L104 22 L106 27 Z" />
          <path className="sil-dash" d="M17 14 H94 M17 19 H99 M17 23 H102" />
          <path d="M30 8 L32 2 H42 L44 8" />
        </g>
      )
    case 'fishing':
      // Trawler: high sheer at the bow, forward wheelhouse, aft gantry
      // (A-frame) with the trawl warp trailing astern.
      return (
        <g>
          <path className="sil-hull" d="M16 27 L80 26 L100 22 L104 31 L98 39 H18 Z" />
          <path className="sil-hull" d="M64 26 V14 H78 V25 Z" />
          <path d="M24 27 L32 8 M40 26 L32 8" />
          <path className="sil-detail" d="M28 17 H36" />
          <path className="sil-dash" d="M32 8 L20 34" />
        </g>
      )
    case 'military':
      // Frigate: raked angular bow, faceted deckhouse, pyramid mast, gun.
      return (
        <g>
          <path className="sil-hull" d="M8 25 H84 L110 20 L102 39 H12 Z" />
          <path className="sil-hull" d="M28 25 L32 12 H54 L58 25 Z" />
          <path d="M40 12 L44 3 L48 12" />
          <path className="sil-hull" d="M64 25 L66 17 H78 L80 25 Z" />
          <path d="M86 24.5 L89 19 L93 23.5" />
        </g>
      )
    case 'highspeed':
      // Fast craft: raked planing wedge riding high, low cabin, wake astern.
      return (
        <g>
          <path className="sil-hull" d="M12 24 L114 19 L96 36 H14 Z" />
          <path className="sil-hull" d="M30 23 L38 14 H74 L88 20 Z" />
          <path className="sil-dash" d="M3 36 H11 M5 39 H13" />
        </g>
      )
    case 'other':
      // Generic coaster: aft wheelhouse, midship hatch coaming, fore mast.
      return (
        <g>
          <path className="sil-hull" d="M10 25 H100 L110 31 L106 39 H12 Z" />
          <path className="sil-hull" d="M16 25 V12 H30 V25 Z" />
          <path d="M40 25 V20 H84 V25" />
          <path d="M94 25 V10" />
          <path className="sil-detail" d="M90 14 H98" />
        </g>
      )
  }
}

/** The framed silhouette: class profile over a dashed amber waterline. */
export function ShipSilhouette({ type }: { type: ShipType }) {
  return (
    <svg
      className="vessel-silhouette"
      viewBox="0 0 120 44"
      role="img"
      aria-label={`${type} vessel side profile`}
    >
      <Profile type={type} />
      <path className="sil-waterline" d="M0 34 H120" />
    </svg>
  )
}
