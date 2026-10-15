/**
 * The fixed signal hues the globe paints with — the ones that are NOT user
 * palette colours (those live in core/ui/prefsStore). A Cesium tint takes a
 * CSS colour string, not a custom property, so each literal here mirrors one
 * styles/tokens.css token; signalColors.test.ts pins every pair together.
 */

/**
 * Selection and launch sites: the selected ship/aircraft decal and the
 * tracked satellite's marker, orbit ring and footprint — whatever the
 * object's own palette hue. Mirrors tokens.css `--amber`.
 */
export const SIGNAL_AMBER = '#ffb454'

/** The tracked satellite's ground track, and ports. Mirrors tokens.css `--cyan`. */
export const SIGNAL_CYAN = '#6ee7ff'

/** Aircraft in the 'ground' band, whatever their category hue. Mirrors tokens.css `--aircraft-ground`. */
export const SIGNAL_GROUND = '#8a93a3'
