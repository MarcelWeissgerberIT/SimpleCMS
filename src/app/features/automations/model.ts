/**
 * Automations — the writer. `Database.automations` is written ONLY with saveAutomations (the Patchbay's patches, B15:
 * AutomationsModal too), under the caller's writer frame (store/writer.ts).
 *
 * B1 (Patchbay seams): the typed writer without the lock rule — refuses a missing database, writes the list as given.
 * B15 fills the rule of §1.14: on a locked database only edits that remove capability (switching an automation off,
 * removing an action or an automation); adds and re-wiring are refused.
 */
import { useWorkspace } from '../../store/store'
import { withWriter, type Writer } from '../../store/writer'
import type { Automation, ID } from '../../store/types'

export { readAutomations } from './read'

/** Write a database's automations as `writer`; false when it was refused (no such database — B15: the lock rule). */
export function saveAutomations(dbId: ID, list: Automation[], writer: Writer): boolean {
  const s = useWorkspace.getState()
  if (!s.databases[dbId]) return false
  withWriter(writer, () => s.updateDatabase(dbId, { automations: list }))
  return true
}
