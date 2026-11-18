/**
 * Globe navigation buttons: compass (north-up + level), zoom + / −, whole
 * Earth, fly to my location. They only request camera commands
 * (core/ui/cameraStore); app/globe/cameraCommands drives the rig. Keys R / Q
 * / E / 0 do the same. Part of .hud-layer, so HIDE takes them off with the
 * rest of the HUD.
 */
import { useEffect, useRef, useState } from 'react'
import { requestCamera, useCameraHeading } from '../core/ui/cameraStore'
import { locateDevice, locateErrorLabel } from '../core/ui/geolocation'

/** LOCATE flies to this height above the device: a regional view. */
const LOCATE_HEIGHT_M = 500_000
/** How long a locate error stays beside the button. */
const LOCATE_MESSAGE_MS = 4_000

/** The only subscriber to the heading store, so a heading change re-renders one button. */
function Compass() {
  const headingDeg = useCameraHeading((s) => s.headingDeg)
  return (
    <button
      type="button"
      className="hud-button nav-button nav-compass"
      aria-label="North up"
      title="North up, look straight down (R)"
      onClick={() => requestCamera({ kind: 'level' })}
    >
      {/* screen north is minus the camera heading */}
      <svg
        className="nav-icon nav-compass-needle"
        viewBox="0 0 24 24"
        aria-hidden
        focusable="false"
        style={{ transform: `rotate(${-headingDeg}deg)` }}
      >
        <path className="nav-compass-north" d="M12 2 16 12H8Z" />
        <path className="nav-compass-south" d="M8 12h8l-4 10Z" />
      </svg>
    </button>
  )
}

function LocateButton() {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const locate = () => {
    if (pending) return
    clearTimeout(timer.current)
    setPending(true)
    setMessage({ text: 'LOCATING…', error: false })
    void locateDevice('geolocation' in navigator ? navigator.geolocation : undefined).then(
      (result) => {
        setPending(false)
        if (result.ok) {
          setMessage(null)
          // Fly even if the controls unmounted meanwhile: the user asked.
          requestCamera({
            kind: 'flyTo',
            lonDeg: result.lonDeg,
            latDeg: result.latDeg,
            heightM: LOCATE_HEIGHT_M,
          })
          return
        }
        setMessage({ text: locateErrorLabel(result.error), error: true })
        timer.current = setTimeout(() => setMessage(null), LOCATE_MESSAGE_MS)
      },
    )
  }

  return (
    <span className="nav-locate">
      <button
        type="button"
        className="hud-button nav-button"
        aria-label="Fly to my location"
        title="Fly to my location"
        aria-busy={pending}
        onClick={locate}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
          <circle className="nav-icon-dot" cx="12" cy="12" r="2" />
        </svg>
      </button>
      <span className={message?.error ? 'nav-message is-error' : 'nav-message'} role="status">
        {message?.text}
      </span>
    </span>
  )
}

export function NavControls() {
  return (
    <div className="nav-controls" role="group" aria-label="Globe navigation">
      <Compass />
      <button
        type="button"
        className="hud-button nav-button"
        aria-label="Zoom in"
        title="Zoom in (Q)"
        onClick={() => requestCamera({ kind: 'zoom', direction: 1 })}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M12 5.5v13M5.5 12h13" />
        </svg>
      </button>
      <button
        type="button"
        className="hud-button nav-button"
        aria-label="Zoom out"
        title="Zoom out (E)"
        onClick={() => requestCamera({ kind: 'zoom', direction: -1 })}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M5.5 12h13" />
        </svg>
      </button>
      <button
        type="button"
        className="hud-button nav-button"
        aria-label="Whole Earth"
        title="Whole Earth view (0)"
        onClick={() => requestCamera({ kind: 'home' })}
      >
        <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden focusable="false">
          <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
          <circle cx="12" cy="12" r="5" />
          <path d="M7 12h10M12 7c-1.6 1.4-1.6 8.6 0 10M12 7c1.6 1.4 1.6 8.6 0 10" />
        </svg>
      </button>
      <LocateButton />
    </div>
  )
}
