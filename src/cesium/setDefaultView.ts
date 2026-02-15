import * as Cesium from 'cesium'

/**
 * Sets initial camera position (Prague for visible 3D buildings).
 */
export function setDefaultView(viewer: Cesium.Viewer) {
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            14.4378, // longitude
            50.0755, // latitude
            1800     // height in meters
        ),
        orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-35),
            roll: 0,
        },
    })
}
