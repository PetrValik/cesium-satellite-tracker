import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useMode } from '../core/ui/modeStore'
import { closeSheetOnEscape, useSheet, type HudSheet } from '../core/ui/sheetStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import { TransportBar } from '../features/timebar/TransportBar'
import { HelpButton } from './HelpOverlay'
import { HideControlsButton } from './HudVisibility'
import { LayersPanel } from './LayersPanel'
import { RailPicture } from './LeftRail'
import { SelectionChip } from './SelectionChip'
import { SelectionPanels } from './SelectionPanels'
import { hasSelectionInMode, useHasSelectionInMode } from './selectionMode'
import { SettingsButton } from './SettingsPanel'

/**
 * Dock label for the focused domain's picture, or null when that domain's
 * layer is off (the picture only renders while its layer is on).
 */
function useRailPictureLabel(): string | null {
  const mode = useMode((s) => s.mode)
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  if (mode === 'orbital') return satellitesOn ? 'CATALOG' : null
  if (mode === 'maritime') return shipsOn ? 'VESSELS' : null
  return aircraftOn ? 'AIRCRAFT' : null
}

const sheetId = (sheet: HudSheet): string => `hud-sheet-${sheet}`

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

function Sheet({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const close = useSheet((s) => s.close)
  return (
    <section
      id={id}
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
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const sheet = useSheet((s) => s.sheet)
  const toggle = useSheet((s) => s.toggle)
  const pictureLabel = useRailPictureLabel()
  const hasSelection = useHasSelectionInMode()

  // Selection drives the sheets: a fresh pick closes the picture / layers
  // sheet so the globe and the chip are visible; losing the focused mode's
  // selection closes details (it would otherwise reopen on the next pick).
  useEffect(() => {
    const sync = (picked: boolean) => {
      const sheets = useSheet.getState()
      if (picked) {
        sheets.closeIf('picture')
        sheets.closeIf('layers')
      }
      if (!hasSelectionInMode()) sheets.closeIf('details')
    }
    const unsubscribe = [
      useCatalog.subscribe((s, p) => {
        if (s.selectedId !== p.selectedId) sync(s.selectedId !== null)
      }),
      useShips.subscribe((s, p) => {
        if (s.selectedMmsi !== p.selectedMmsi) sync(s.selectedMmsi !== null)
      }),
      useAircraft.subscribe((s, p) => {
        if (s.selectedIcao !== p.selectedIcao) sync(s.selectedIcao !== null)
      }),
      useMode.subscribe((s, p) => {
        if (s.mode !== p.mode) sync(false)
      }),
    ]
    return () => unsubscribe.forEach((off) => off())
  }, [])

  // a sheet with nothing to show (domain layer off / nothing selected) is closed
  const openSheet =
    (sheet === 'picture' && pictureLabel === null) || (sheet === 'details' && !hasSelection)
      ? null
      : sheet

  // The store mirrors the screen: a sheet that cannot render is closed, not
  // left pending, and leaving the compact layout (rotation / resize across
  // the breakpoint) closes it — otherwise GlobeView's Escape would spend a
  // press closing a sheet nobody can see.
  useEffect(() => {
    if (sheet !== null && openSheet === null) useSheet.getState().close()
  }, [sheet, openSheet])
  useEffect(() => () => useSheet.getState().close(), [])

  useSheetFocusReturn(openSheet)

  return (
    <div className="compact-cluster">
      {openSheet === 'picture' && pictureLabel !== null && (
        <Sheet id="hud-sheet-picture" title={pictureLabel}>
          <RailPicture />
        </Sheet>
      )}
      {openSheet === 'layers' && (
        <Sheet id="hud-sheet-layers" title="LAYERS">
          <LayersPanel />
        </Sheet>
      )}
      {openSheet === 'details' && (
        <section
          id="hud-sheet-details"
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
          {pictureLabel !== null && (
            <button
              className={`hud-button dock-button${openSheet === 'picture' ? ' is-active' : ''}`}
              aria-expanded={openSheet === 'picture'}
              aria-controls="hud-sheet-picture"
              onClick={() => toggle('picture')}
            >
              {pictureLabel}
            </button>
          )}
          <button
            className={`hud-button dock-button${openSheet === 'layers' ? ' is-active' : ''}`}
            aria-expanded={openSheet === 'layers'}
            aria-controls="hud-sheet-layers"
            onClick={() => toggle('layers')}
          >
            LAYERS
          </button>
          <HelpButton />
          <SettingsButton />
          <HideControlsButton />
        </nav>
        {satellitesOn && <TransportBar />}
      </div>
    </div>
  )
}
