import { useMode } from '../core/ui/modeStore'

interface HelpSection {
  title: string
  rows: [string, string][]
}

/** Shown first, and only on coarse pointers (index.css `.help-touch`). */
const TOUCH_SECTION: HelpSection = {
  title: 'TOUCH',
  rows: [
    ['DRAG', 'Rotate the globe / orbit the followed object'],
    ['PINCH', 'Zoom'],
    ['TWO-FINGER DRAG', 'Tilt the view'],
    ['TAP OBJECT', 'Select (ships & aircraft also lock the camera)'],
    ['TAP EMPTY GLOBE', 'Deselect'],
    ['CATALOG · LAYERS', 'Dock buttons: open the picture / layer sheet'],
    ['FOLLOW · DETAILS · ✕', 'Selection chip: follow-lock, full readout, deselect'],
    ['▶ ❚❚ · − + · NOW', 'Play / pause, slower / faster warp, reset to NOW'],
    ['HIDE', 'Dock: hide every control; the eye button bottom-left brings them back'],
  ],
}

const SECTIONS: HelpSection[] = [
  {
    title: 'MOUSE',
    rows: [
      ['DRAG', 'Rotate the globe / orbit the followed object'],
      ['WHEEL', 'Zoom'],
      ['CLICK OBJECT', 'Select (ships & aircraft also lock the camera)'],
      ['CLICK EMPTY', 'Deselect'],
    ],
  },
  {
    title: 'CAMERA',
    rows: [
      ['W A S D / ARROWS', 'Rotate view / orbit target'],
      ['Q / E', 'Zoom in / out'],
      ['F', 'Toggle camera follow-lock on the selection'],
      ['ESC', 'Close help / colors / sheet, then release follow-lock, then deselect'],
    ],
  },
  {
    title: 'LAYERS & TIME',
    rows: [
      ['1 / 2 / 3', 'Toggle ORBITAL / MARITIME / AIRSPACE layer'],
      ['SPACE', 'Play / pause simulation time (ORBITAL on)'],
      [', / .', 'Slower / faster time warp (ORBITAL on)'],
      ['N', 'Reset simulation to NOW'],
      ['H or ?', 'Toggle this help'],
    ],
  },
  {
    title: 'HUD',
    rows: [
      ['U', 'Hide / show all controls (HIDE button)'],
      ['ESC', 'While hidden: show the controls, nothing else'],
    ],
  },
]

export function HelpOverlay() {
  const open = useMode((s) => s.helpOpen)
  const close = useMode((s) => s.closeHelp)
  if (!open) return null

  return (
    <div className="help-backdrop" onClick={close} role="presentation">
      <section
        className="hud-panel help-panel"
        role="dialog"
        aria-label="Controls help"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="telemetry-header">
          <h2 className="hud-title">CONTROLS</h2>
          <button className="hud-button" onClick={close} title="Close" aria-label="Close help">
            ✕
          </button>
        </header>
        {[TOUCH_SECTION, ...SECTIONS].map((section) => (
          <div
            key={section.title}
            className={`help-section${section === TOUCH_SECTION ? ' help-touch' : ''}`}
          >
            <h3 className="help-section-title">{section.title}</h3>
            <dl className="help-grid">
              {section.rows.map(([key, what]) => (
                <div className="help-row" key={key}>
                  <dt>
                    <kbd>{key}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className="help-footnote">
          Ships & aircraft are live (wall clock); satellites follow simulation time.
        </p>
      </section>
    </div>
  )
}

/** Small launcher button pinned to the bottom-left corner. */
export function HelpButton() {
  const toggle = useMode((s) => s.toggleHelp)
  return (
    <button className="hud-button help-button" onClick={toggle} title="Controls help (H)">
      ? HELP
    </button>
  )
}
