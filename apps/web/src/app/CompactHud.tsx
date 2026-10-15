import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { transportVisible, useMode } from '../core/ui/modeStore'
import { closeSheetOnEscape, useSheet, type HudSheet } from '../core/ui/sheetStore'
import { TransportBar } from '../features/timebar/TransportBar'
import { bindSheetsToSelection, sheetId, visibleSheet } from './compactSheets'
import { HelpButton } from './HelpOverlay'
import { HideControlsButton } from './HudVisibility'
import { LayersPanel } from './LayersPanel'
import { RailPicture } from './LeftRail'
import { useRailPicture } from './railPicture'
import { SelectionChip } from './SelectionChip'
import { SelectionPanels } from './SelectionPanels'
import { useHasSelectionInMode } from './selectionMode'
import { SettingsButton } from './SettingsPanel'

/**
 * Closing a sheet unmounts it, which drops a keyboard user's focus to
 * <body>. When focus was inside the closing sheet, hand it back to the
 * control that opens it (dock button / chip DETAILS, matched by
 * aria-controls) — same idea as swapFocus in HudVisibility. The store
 * listener runs inside set(), before React removes the sheet, so it still
 * sees where focus is; the layout effect runs once the sheet is gone.
 */
function useSheetFocusReturn(openSheet: HudSheet | null): void {
  const returnTo = useRef<string | null>(null)
  useEffect(
    () =>
      useSheet.subscribe((s, p) => {
        if (p.sheet === null || s.sheet === p.sheet) return
        const id = sheetId(p.sheet)
        if (document.getElementById(id)?.contains(document.activeElement)) returnTo.current = id
      }),
    [],
  )
  useLayoutEffect(() => {
    const id = returnTo.current
    returnTo.current = null
    if (id === null || (openSheet !== null && sheetId(openSheet) === id)) return
    document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus()
  }, [openSheet])
}

function Sheet({ sheet, title, children }: { sheet: HudSheet; title: string; children: ReactNode }) {
  const close = useSheet((s) => s.close)
  return (
    <section
      id={sheetId(sheet)}
      className="hud-panel hud-sheet"
      role="region"
      aria-label={title}
      onKeyDown={closeSheetOnEscape}
    >
      <header className="sheet-header">
        <h2 className="hud-title">{title}</h2>
        <button className="hud-button sheet-close" onClick={close} aria-label={`Close ${title}`}>
          ✕
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  )
}

/**
 * Phone HUD (useCompactLayout): the desktop side panels become sheets that
 * open above a dock of HUD buttons, the selection shrinks to a chip, and the
 * transport bar closes the bottom cluster. One flex cluster stacks them, so
 * nothing needs to know another element's height.
 */
export function CompactHud() {
  const transportOn = useMode(transportVisible)
  const sheet = useSheet((s) => s.sheet)
  const toggle = useSheet((s) => s.toggle)
  const picture = useRailPicture()
  const hasSelection = useHasSelectionInMode()

  useEffect(() => bindSheetsToSelection(), [])

  const openSheet = visibleSheet(sheet, picture !== null, hasSelection)

  // The store mirrors the screen: a sheet that cannot render is closed, not
  // left pending, and leaving the compact layout (rotation / resize across
  // the breakpoint) closes it — otherwise the globe keys' Escape
  // (app/globe/globeKeys.ts) would spend a press closing a sheet nobody can
  // see.
  useEffect(() => {
    if (sheet !== null && openSheet === null) useSheet.getState().close()
  }, [sheet, openSheet])
  useEffect(() => () => useSheet.getState().close(), [])

  useSheetFocusReturn(openSheet)

  return (
    <div className="compact-cluster">
      {openSheet === 'picture' && picture !== null && (
        <Sheet sheet="picture" title={picture.label}>
          <RailPicture />
        </Sheet>
      )}
      {openSheet === 'layers' && (
        <Sheet sheet="layers" title="LAYERS">
          <LayersPanel />
        </Sheet>
      )}
      {openSheet === 'details' && (
        <section
          id={sheetId('details')}
          className="hud-sheet sheet-details"
          role="region"
          aria-label="Selection details"
          onKeyDown={closeSheetOnEscape}
        >
          <div className="sheet-body">
            <SelectionPanels />
          </div>
        </section>
      )}
      <div className="cluster-stack">
        {/* the chip stays under the details sheet as its handle */}
        {openSheet !== 'picture' && openSheet !== 'layers' && <SelectionChip />}
        <nav className="hud-dock" aria-label="HUD panels">
          {picture !== null && (
            <button
              className={`hud-button dock-button${openSheet === 'picture' ? ' is-active' : ''}`}
              aria-expanded={openSheet === 'picture'}
              aria-controls={sheetId('picture')}
              onClick={() => toggle('picture')}
            >
              {picture.label}
            </button>
          )}
          <button
            className={`hud-button dock-button${openSheet === 'layers' ? ' is-active' : ''}`}
            aria-expanded={openSheet === 'layers'}
            aria-controls={sheetId('layers')}
            onClick={() => toggle('layers')}
          >
            LAYERS
          </button>
          <HelpButton />
          <SettingsButton />
          <HideControlsButton />
        </nav>
        {transportOn && <TransportBar />}
      </div>
    </div>
  )
}
