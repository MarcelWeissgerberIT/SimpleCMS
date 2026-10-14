/**
 * AUTOMATIONS — public API (features/automations; re-exported by features/index.ts). Database automations: a trigger
 * on a database's rows runs actions (webhook · set_property · notify · run_script) in the tab where the change happened.
 *  - startAutomations(): background service (main.tsx, once after hydrate)
 *  - AutomationsModal (modal 'automations' { databaseId })
 *  - useRunLog() / getRunLog(): this tab's run log (in memory, the last 30 actions)
 *  - onAutomationAction(fn): every action this tab ran, as it ends (ids, kinds, status — never text): the Patchbay's
 *    live signal (automation → its way out)
 *  - readAutomations(raw): THE reader of Database.automations (B15: sanitized) · saveAutomations(dbId, list, writer):
 *    THE writer (B15: a locked database takes only switching off and removals)
 */
export { startAutomations, useRunLog, getRunLog, onAutomationAction, type RunLogEntry, type AutomationActionNote } from './engine'
export { AutomationsModal } from './AutomationsModal'
export { readAutomations } from './read'
export { saveAutomations } from './model'
