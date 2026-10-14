/**
 * The one way into AI setup (UX § 3): openAISetup() opens the assistant "Set up AI" (modal 'aiSetup', a lazy chunk) at
 * the step a reason points to — every "no key" surface, the AI-menu card, ⌘K "Set up AI", the changelog's try and the
 * error keys of a refused request use it. openAISettings() opens Settings › AI (this device), scrolled to the MCP
 * servers or the memory when asked — MCP fixes go there, never to the key assistant (D-S2-12).
 * Nothing heavy here: this module is on the boot path of every surface that offers the keys.
 */
import type { DataClass, FeatureClass, ProviderId } from '@/shared/ai/types'
import { useUI, type AISetupReason, type AISetupStep } from '../../../store/ui'
import { handFocusOver } from '../../../ui/focus'

export interface AISetupOptions {
  reason?: AISetupReason
  /** the kind of work that asked (named in the plates, preselected in step 05) */
  feature?: FeatureClass
  /** that provider's tab / plate */
  provider?: ProviderId
  /** start here (else the reason decides) */
  step?: AISetupStep
  /** 'policy': the class that was refused (step 04 focuses its row) */
  data?: DataClass
}

/** The step a reason starts at when none is named. */
export function stepOf(o: AISetupOptions): AISetupStep {
  if (o.step) return o.step
  switch (o.reason) {
    case 'policy':
      return 'data'
    case 'refused':
    case 'no_credit':
    case 'rotate':
      return 'key'
    case 'models':
    case 'capability':
      return 'models'
    default:
      return 'provider'
  }
}

/** The element a dialog should hand focus back to when it closes (the key pressed in a closing palette / drawer). */
function handOver(): void {
  const el = document.activeElement
  if (el instanceof HTMLElement && el !== document.body) handFocusOver(el)
}

/** Open the AI setup assistant (closes the palette and the phone drawer first). */
export function openAISetup(o: AISetupOptions = {}): void {
  const ui = useUI.getState()
  handOver()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  ui.openModal({ type: 'aiSetup', ...o, step: stepOf(o) })
}

/**
 * Open Settings › AI (this device) — at its MCP servers or its memory switches when asked. With the MCP servers:
 * `server` = that server's details open, its toggle focused · `add` = the add form open, its URL field focused.
 */
export function openAISettings(o: { section?: 'mcp' | 'memory' | 'limit'; server?: string; add?: boolean } = {}): void {
  const ui = useUI.getState()
  handOver()
  if (ui.paletteOpen) ui.closePalette()
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  const mcp = o.section === 'mcp' ? { ...(o.server ? { server: o.server } : {}), ...(o.add ? { add: true } : {}) } : {}
  ui.openModal({ type: 'settings', tab: 'ai', ...(o.section ? { section: o.section } : {}), ...mcp })
}
