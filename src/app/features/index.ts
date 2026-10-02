/**
 * FEATURES AREA — public API (contract). Shell/editor/database import ONLY from this file.
 *
 *  Background services (started once from main.tsx after hydrate):
 *   - startHistory(): periodic page snapshots for version history
 *   - startAutomations(): runs database automations (webhooks …) on store changes
 *
 *  AI (Claude, bring-your-own-key):
 *   - isAIConfigured(), runAI(), AIMenu (component the editor shows for selection / "Ask AI")
 *
 *  Views / modals (rendered by the shell):
 *   - GraphView (route #/graph), SharedPageView (route #/s/…), Presentation (overlay)
 *   - HistoryModal, ShareModal, ImportModal, ExportModal, AutomationsModal, TemplatesModal
 *   - openTodayJournal()
 */
export { startHistory } from './history/snapshots'
export { HistoryModal } from './history/HistoryModal'
export { startAutomations } from './automations/engine'
export { AutomationsModal } from './automations/AutomationsModal'
export { isAIConfigured, runAI, type AIAction, type RunAIOptions } from './ai/client'
export { AIMenu, type AIMenuProps } from './ai/AIMenu'
export { GraphView } from './graph/GraphView'
export { ShareModal } from './share/ShareModal'
export { SharedPageView } from './share/SharedPageView'
export { ImportModal } from './io/ImportModal'
export { ExportModal } from './io/ExportModal'
export { Presentation } from './present/Presentation'
export { TemplatesModal } from './templates/TemplatesModal'
export { openTodayJournal } from './journal/journal'
