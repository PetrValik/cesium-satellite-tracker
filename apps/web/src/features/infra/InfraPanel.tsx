import { useMode } from '../../core/ui/modeStore'
import launchSites from '../../data/launchSites.json'
import ports from '../../data/ports.json'

/** Overlay toggles for the static infrastructure layers (all modes). */
export function InfraPanel() {
  const launchSitesOn = useMode((s) => s.launchSites)
  const portsOn = useMode((s) => s.ports)
  const toggleLaunchSites = useMode((s) => s.toggleLaunchSites)
  const togglePorts = useMode((s) => s.togglePorts)

  return (
    <>
      <h2 className="hud-title infra-title">INFRA</h2>
      <ul className="group-list">
        <li>
          <button
            className={`group-row${launchSitesOn ? ' is-active' : ''}`}
            onClick={toggleLaunchSites}
          >
            <span className="group-indicator" aria-hidden />
            <span className="group-name">LAUNCH SITES</span>
            <span className="group-count">{launchSites.length}</span>
          </button>
        </li>
        <li>
          <button className={`group-row${portsOn ? ' is-active' : ''}`} onClick={togglePorts}>
            <span className="group-indicator infra-port" aria-hidden />
            <span className="group-name">MAJOR PORTS</span>
            <span className="group-count">{ports.length}</span>
          </button>
        </li>
      </ul>
    </>
  )
}
