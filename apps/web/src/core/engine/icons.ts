/**
 * Programmatic icon sprites for the billboard layers — no external assets.
 *
 * Every glyph is drawn WHITE on a transparent 64×64 canvas. Billboard.color
 * multiplies the texture, so a single white sprite per layer is tinted per
 * instance: one texture atlas entry, per-object colors. Black pixels stay
 * black under any tint, which is how the satellite sprite carries a dark
 * halo that keeps light palette hues visible on the light basemap.
 *
 * Conventions:
 * - bold, simple silhouettes that stay readable at ~28 px;
 * - centered, with ~6 px padding to the canvas edge;
 * - rotatable glyphs (aircraft, ship, rocket) point UP (toward -y), so a
 *   billboard rotation of 0 renders them nose-up on screen.
 *
 * Each exported function is memoized: the canvas is drawn once and the same
 * element is returned on every call (callers use it with a fixed image id,
 * so the atlas also holds it once).
 */

const SIZE = 64
const CENTER_X = SIZE / 2
const TWO_PI = Math.PI * 2

/** Memoize a draw callback into a lazily created, cached canvas. */
function memoIcon(draw: (ctx: CanvasRenderingContext2D) => void): () => HTMLCanvasElement {
  let cached: HTMLCanvasElement | null = null
  return () => {
    if (cached !== null) return cached
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('2D canvas context unavailable for icon sprites')
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    draw(ctx)
    cached = canvas
    return cached
  }
}

/**
 * Fill a left/right-symmetric silhouette. `rightHalf` lists the right-half
 * outline from top to bottom (x >= 32); the left half is mirrored back up
 * automatically.
 */
function fillSymmetric(
  ctx: CanvasRenderingContext2D,
  rightHalf: readonly (readonly [number, number])[],
): void {
  ctx.beginPath()
  ctx.moveTo(rightHalf[0][0], rightHalf[0][1])
  for (let i = 1; i < rightHalf.length; i++) {
    ctx.lineTo(rightHalf[i][0], rightHalf[i][1])
  }
  for (let i = rightHalf.length - 1; i >= 0; i--) {
    ctx.lineTo(2 * CENTER_X - rightHalf[i][0], rightHalf[i][1])
  }
  ctx.closePath()
  ctx.fill()
}

/** Satellite body: solar wings joined to a central bus by short struts. */
const SATELLITE_BODY: readonly (readonly [number, number, number, number])[] = [
  [6, 25, 13, 14], // left panel
  [45, 25, 13, 14], // right panel
  [19, 30, 4, 4], // left strut
  [41, 30, 4, 4], // right strut
  [23, 21, 18, 22], // central bus
]
/** Thin gaps in the wings, so they read as solar-cell panels up close. */
const SATELLITE_GAPS: readonly (readonly [number, number, number, number])[] = [
  [10, 25, 1.5, 14],
  [14.5, 25, 1.5, 14],
  [48, 25, 1.5, 14],
  [52.5, 25, 1.5, 14],
]
/** The glyph is drawn at 90 % so its dark halo fits inside the 64 px canvas. */
const SATELLITE_GLYPH_SCALE = 0.9
/** Halo: a 3.5 px dark outline plus a soft dark glow, in canvas px. */
const SATELLITE_OUTLINE_PX = 3.5
const SATELLITE_GLOW_PX = 10

/**
 * Satellite: central bus with two solar-panel wings (non-rotating glyph),
 * white on a dark halo. Palette v2's light satellite hues vanish on the light
 * `streets` basemap's day side (contrast ~1.1:1 on land); the halo stays dark
 * under any tint, so the dot reads at every range: measured 2026-11-18 at the
 * whole-Earth view, LEO on light land went from 1.10 to 14.4:1 (min) with the
 * night side unchanged (6.2:1).
 */
export const satelliteIcon = memoIcon((ctx) => {
  ctx.save()
  ctx.translate(CENTER_X, CENTER_X)
  ctx.scale(SATELLITE_GLYPH_SCALE, SATELLITE_GLYPH_SCALE)
  ctx.translate(-CENTER_X, -CENTER_X)
  // Halo: outline the body (with a dark glow), then fill it dark so the
  // wing gaps show dark too.
  ctx.fillStyle = '#000000'
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = (2 * SATELLITE_OUTLINE_PX) / SATELLITE_GLYPH_SCALE
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
  ctx.shadowBlur = SATELLITE_GLOW_PX
  ctx.beginPath()
  for (const [x, y, w, h] of SATELLITE_BODY) ctx.rect(x, y, w, h)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fill()
  // Glyph on top: the white body, then the gaps back in the halo colour.
  ctx.fillStyle = '#ffffff'
  for (const [x, y, w, h] of SATELLITE_BODY) ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#000000'
  for (const [x, y, w, h] of SATELLITE_GAPS) ctx.fillRect(x, y, w, h)
  ctx.restore()
})

/** Aircraft: top-view airliner silhouette, nose up. */
export const aircraftIcon = memoIcon((ctx) => {
  fillSymmetric(ctx, [
    [32, 5], // nose
    [35.5, 14], // cockpit shoulder
    [35.5, 26], // wing root, leading edge
    [58, 39], // wing tip, leading edge
    [58, 44], // wing tip, trailing edge
    [35, 35], // wing root, trailing edge
    [34, 47], // rear fuselage taper
    [45, 54], // tailplane tip, leading edge
    [45, 58], // tailplane tip, trailing edge
    [32, 56], // tail center
  ])
})

/**
 * Ship: top-view hull, bow up. Elongated (~3:1 length:beam) with a long,
 * sharp bow taper so the heading is unmistakable at billboard scale, and a
 * transverse deck-break cut near the stern so the aft block reads as the
 * bridge/superstructure (and the long fore deck as cargo space) up close.
 */
export const shipIcon = memoIcon((ctx) => {
  fillSymmetric(ctx, [
    [32, 5], // bow tip
    [35.5, 14], // fine entry at the stem
    [41, 29], // bow flare reaches full beam
    [41, 53], // starboard side aft
    [38.5, 58], // stern quarter tuck
    [32, 58], // flat transom
  ])
  // Deck break: cut just ahead of the aft superstructure, leaving a gunwale
  // on each side. One bold negative-space detail — legible at ~50% scale.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillRect(26, 42.5, 12, 3.5)
  ctx.globalCompositeOperation = 'source-over'
})

/** Rocket: upright rocket — nose cone, body, fins, nozzle — with a porthole. */
export const rocketIcon = memoIcon((ctx) => {
  // Nose cone + body.
  ctx.beginPath()
  ctx.moveTo(32, 4)
  ctx.quadraticCurveTo(39, 10, 39, 20)
  ctx.lineTo(39, 48)
  ctx.lineTo(25, 48)
  ctx.lineTo(25, 20)
  ctx.quadraticCurveTo(25, 10, 32, 4)
  ctx.closePath()
  ctx.fill()
  // Fins.
  ctx.beginPath()
  ctx.moveTo(25, 36)
  ctx.lineTo(16, 54)
  ctx.lineTo(25, 50)
  ctx.closePath()
  ctx.moveTo(39, 36)
  ctx.lineTo(48, 54)
  ctx.lineTo(39, 50)
  ctx.closePath()
  ctx.fill()
  // Nozzle.
  ctx.beginPath()
  ctx.moveTo(29, 48)
  ctx.lineTo(35, 48)
  ctx.lineTo(38, 56)
  ctx.lineTo(26, 56)
  ctx.closePath()
  ctx.fill()
  // Porthole cut-out.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(32, 22, 3.5, 0, TWO_PI)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
})

/** Anchor: classic ring, shank, stock, curved arms, and fluke barbs. */
export const anchorIcon = memoIcon((ctx) => {
  // Ring.
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(32, 12, 4.5, 0, TWO_PI)
  ctx.stroke()
  ctx.lineWidth = 5
  // Shank.
  ctx.beginPath()
  ctx.moveTo(32, 16.5)
  ctx.lineTo(32, 51)
  ctx.stroke()
  // Stock (crossbar).
  ctx.beginPath()
  ctx.moveTo(22, 24)
  ctx.lineTo(42, 24)
  ctx.stroke()
  // Arms: bottom arc between the two fluke tips.
  ctx.beginPath()
  ctx.arc(32, 34, 17, Math.PI * 0.92, Math.PI * 0.08, true)
  ctx.stroke()
  // Flukes: barb triangles at the arm tips.
  ctx.beginPath()
  ctx.moveTo(15.5, 45)
  ctx.lineTo(8, 34)
  ctx.lineTo(22, 35.5)
  ctx.closePath()
  ctx.moveTo(48.5, 45)
  ctx.lineTo(56, 34)
  ctx.lineTo(42, 35.5)
  ctx.closePath()
  ctx.fill()
})
