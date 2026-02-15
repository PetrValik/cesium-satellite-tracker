import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import { createViewer } from '../cesium/createViewer'
import { setDefaultView } from '../cesium/setDefaultView'
import { addOsmBuildings } from '../cesium/addOsmBuildings'

/**
 * React wrapper for Cesium Viewer.
 * Handles initialization and cleanup only.
 */
export default function Globe() {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewerRef = useRef<Cesium.Viewer | null>(null)

    useEffect(() => {
        if (!containerRef.current) return

        // Prevent double initialization (React StrictMode)
        if (viewerRef.current) return

        // Create viewer
        const viewer = createViewer(containerRef.current)
        viewerRef.current = viewer

        // Set initial camera
        setDefaultView(viewer)

        // Add base layers
        addOsmBuildings(viewer).catch((err) => {
            console.warn('Failed to add OSM Buildings', err)
        })

        // Cleanup on unmount
        return () => {
            viewerRef.current?.destroy()
            viewerRef.current = null
        }
    }, [])

    return <div ref={containerRef} className="globe-container" />

}
