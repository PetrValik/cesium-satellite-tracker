import { useMode } from '../core/ui/modeStore'

const SECTIONS: { title: string; rows: [string, string][] }[] = [
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
      ['ESC', 'Release follow-lock, then deselect'],
    ],
  },
  {
    title: 'MODES & TIME',
    rows: [
      ['1 / 2 / 3', 'ORBITAL / MARITIME / AIRSPACE'],
      ['SPACE', 'Play / pause simulation time'],
      [', / .', 'Slower / faster time warp'],
      ['N', 'Reset simulation to NOW'],
      ['H or ?', 'Toggle this help'],
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
          <button className="hud-button" onClick={close} title="Close">
            ✕
          </button>
        </header>
        {SECTIONS.map((section) => (
          <div key={section.title} className="help-section">
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
