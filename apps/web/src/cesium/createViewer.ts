import * as Cesium from 'cesium'

// Set Cesium Ion token from environment
Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN

/**
 * Creates a base Cesium Viewer with terrain and minimal UI.
 */
export function createViewer(container: HTMLDivElement): Cesium.Viewer {
    return new Cesium.Viewer(container, {
        terrain: Cesium.Terrain.fromWorldTerrain(),

        // Disable default UI (custom UI will be added later)
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
    })
}
