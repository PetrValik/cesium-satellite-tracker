import type { ReactNode } from 'react'

/**
 * Modal shell shared by HELP and COLORS: a scrim that closes on click, the
 * dialog panel, and a header with the title, optional actions and ✕.
 * Escape is GlobeView's window handler (staged: dialogs close first).
 */
export function HudDialog({
  label,
  title,
  hook,
  onClose,
  closeLabel,
  actions,
  children,
}: {
  /** Accessible name of the dialog. */
  label: string
  title: string
  /** Per-dialog class (no rule of its own — a stable hook for tests and tooling). */
  hook: string
  onClose: () => void
  closeLabel: string
  /** Header buttons placed before ✕. */
  actions?: ReactNode
  children: ReactNode
}) {
  const close = (
    <button className="hud-button" onClick={onClose} title="Close" aria-label={closeLabel}>
      ✕
    </button>
  )
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <section
        className={`hud-panel dialog-panel ${hook}`}
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="telemetry-header">
          <h2 className="hud-title">{title}</h2>
          {actions ? (
            <span className="panel-actions">
              {actions}
              {close}
            </span>
          ) : (
            close
          )}
        </header>
        {children}
      </section>
    </div>
  )
}
