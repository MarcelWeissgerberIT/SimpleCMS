/** What capture shows right now (CaptureHost renders it): the quick capture sheet, the install placard. */
import { create } from 'zustand'

interface CaptureUI {
  sheet: boolean
  placard: boolean
}

export const useCaptureUI = create<CaptureUI>(() => ({ sheet: false, placard: false }))

export const openQuickCapture = () => useCaptureUI.setState({ sheet: true })
export const closeQuickCapture = () => useCaptureUI.setState({ sheet: false })
export const openInstallPlacard = () => useCaptureUI.setState({ placard: true })
export const closeInstallPlacard = () => useCaptureUI.setState({ placard: false })

/** Quick capture everywhere: phones' floating key, ⌘⇧K / Ctrl+Shift+K, ⌘K, the home-screen shortcut. */
export const QUICK_CAPTURE_SHORTCUT = 'Mod+Shift+K'
