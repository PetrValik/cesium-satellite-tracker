import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  LabelCollection,
  NearFarScalar,
} from 'cesium'
import type { Scene } from 'cesium'
import { rocketIcon } from '../../core/engine/icons'

/** Static launch-site descriptor (matches launchSites.json rows). */
export interface LaunchSite {
  id: string
  name: string
  latDeg: number
  lonDeg: number
}

const ICON_COLOR = Color.fromCssColorString('#ffb454') // signal amber

/**
 * Distance scaling: the rocket sprite is 64 px and Billboard.scale
 * multiplies it, so targetPx / 64 is the scale:
 *  - within 8e6 m (continental view and closer): 20 / 64 → a ~20 px rocket;
 *  - by 4e7 m (whole-globe camera range): 6 / 64 → a ~6 px mark.
 * Shared across all billboards; the Billboard constructor clones it
 * (NearFarScalar.clone in cesium 1.138) and we never mutate it.
 */
const SPRITE_PX = 64
const SCALE_BY_DISTANCE = new NearFarScalar(8e6, 20 / SPRITE_PX, 4e7, 6 / SPRITE_PX)

/** One fixed atlas id: every site shares the single rocket sprite entry. */
const ROCKET_IMAGE_ID = 'icon:rocket'

const LABEL_FONT = '10px monospace'
const LABEL_FILL = Color.fromCssColorString('#d7dde6')
/** Up-right of the icon (screen space: +x right, -y up). */
const LABEL_OFFSET = new Cartesian2(8, -8)
/**
 * Labels only render when the camera is within ~12,000 km — icons stay
 * visible from any distance, the text would just be clutter from orbit.
 * Shared across all labels; the Label setter clones it and we never mutate.
 */
const LABEL_DISPLAY_CONDITION = new DistanceDisplayCondition(0, 12_000_000)

/**
 * Camera-ward eye offset: with scene.globe.depthTestAgainstTerrain enabled,
 * surface-level billboards half-sink into the terrain and z-fight at
 * grazing angles. Eye coordinates are left-handed with +z pointing INTO the
 * screen (Billboard.eyeOffset docs, cesium 1.138), so negative z pulls the
 * sprite (and label) 3 km toward the viewer — imperceptible at the
 * continental distances this layer is viewed from, but decisively in front
 * of the terrain depth. Shared instance: the Billboard and Label
 * constructors clone it (Cartesian3.clone in cesium 1.138) and we never
 * mutate it.
 */
const EYE_OFFSET = new Cartesian3(0, 0, -3000)

// Constructor-only scratch (the layer is static; nothing runs per frame).
// Safe to share because Billboard/Label position handling clones the value
// rather than retaining our reference (verified in cesium 1.138).
const scratchPosition = new Cartesian3()

/**
 * Static overlay of orbital launch sites: one amber-tinted rocket billboard
 * plus one name label per site, built once in the constructor. Billboards
 * and labels keep the default disableDepthTestDistance, so they hide behind
 * the globe. No rotation — an upright rocket reads at any camera heading.
 */
export class LaunchSitesLayer {
  private readonly _scene: Scene
  private readonly _billboards: BillboardCollection
  private readonly _labels: LabelCollection

  constructor(scene: Scene, sites: LaunchSite[]) {
    this._scene = scene
    this._billboards = new BillboardCollection()
    this._labels = new LabelCollection()
    scene.primitives.add(this._billboards)
    scene.primitives.add(this._labels)

    const sprite = rocketIcon()
    for (const site of sites) {
      Cartesian3.fromDegrees(site.lonDeg, site.latDeg, 0, undefined, scratchPosition)
      const billboard = this._billboards.add({
        id: site.id,
        position: scratchPosition,
        color: ICON_COLOR,
        scaleByDistance: SCALE_BY_DISTANCE,
        eyeOffset: EYE_OFFSET,
      })
      // Fixed image id → one shared atlas entry for all sites.
      billboard.setImage(ROCKET_IMAGE_ID, sprite)
      this._labels.add({
        id: site.id,
        position: scratchPosition,
        text: site.name,
        font: LABEL_FONT,
        fillColor: LABEL_FILL,
        pixelOffset: LABEL_OFFSET,
        distanceDisplayCondition: LABEL_DISPLAY_CONDITION,
        eyeOffset: EYE_OFFSET,
      })
    }
  }

  /** Show or hide the whole layer (icons and labels together). */
  setVisible(visible: boolean): void {
    if (this._isUnusable()) return
    this._billboards.show = visible
    this._labels.show = visible
  }

  /**
   * Returns the site id under the cursor if the picked primitive (billboard
   * or label) belongs to this layer, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): string | null {
    if (scene.isDestroyed() || this._billboards.isDestroyed() || this._labels.isDestroyed()) {
      return null
    }
    // Scene.pick returns { primitive, collection, id } for billboards and labels.
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      (picked.collection === this._billboards || picked.collection === this._labels) &&
      typeof picked.id === 'string'
    ) {
      return picked.id
    }
    return null
  }

  dispose(): void {
    if (this._scene.isDestroyed()) return
    // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
    // also destroys each collection.
    if (!this._billboards.isDestroyed()) this._scene.primitives.remove(this._billboards)
    if (!this._labels.isDestroyed()) this._scene.primitives.remove(this._labels)
  }

  private _isUnusable(): boolean {
    return (
      this._billboards.isDestroyed() || this._labels.isDestroyed() || this._scene.isDestroyed()
    )
  }
}
