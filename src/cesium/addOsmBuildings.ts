import * as Cesium from 'cesium'

/**
 * Loads and adds Cesium OSM 3D Buildings layer.
 */
export async function addOsmBuildings(viewer: Cesium.Viewer) {
    try {
        const tileset = await Cesium.createOsmBuildingsAsync()
        viewer.scene.primitives.add(tileset)
    } catch (error) {
        console.warn('OSM Buildings failed to load', error)
    }
}
