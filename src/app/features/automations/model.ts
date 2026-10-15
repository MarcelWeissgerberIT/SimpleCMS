/**
 * Automations — the writer. `Database.automations` is written ONLY with saveAutomations: AutomationsModal, the engine's
 * bookkeeping (`last*`, SYSTEM('bookkeeping')) and the Patchbay's patches, each under its own writer frame
 * (store/writer.ts). Plan §1.14 (B15):
 *  - a missing database is refused;
 *  - the list is sanitized (read.ts readAutomations) — and every stored entry this build cannot read (a newer build's
 *    trigger or action) is kept as it is, after the readable ones: an older tab never deletes what a newer one made;
 *  - on a LOCKED database only edits that remove capability pass (read.ts lockRefusal: switching an automation off,
 *    removing an action or an automation); adds, re-wiring, renaming and switching on are refused (owner question Q2,
 *    default). Bookkeeping alone (`last*`) changes no config, so the engine's status write passes a locked database.
 * Returns false when nothing was written.
 */
import { useWorkspace } from '../../store/store'
import { withWriter, type Writer } from '../../store/writer'
import type { Automation, ID } from '../../store/types'
import { lockRefusal, readAutomations, unreadableAutomations, type LockRefusal } from './read'

export { readAutomations } from './read'

/** Why a save would be refused (null: it would be written) — the modal and the Patchbay ask before they write. */
export function automationsRefusal(dbId: ID, list: Automation[]): 'missing' | LockRefusal | null {
  const db = useWorkspace.getState().databases[dbId]
  if (!db) return 'missing'
  if (!db.locked) return null
  return lockRefusal(readAutomations(db.automations), readAutomations(list))
}

/** Write a database's automations as `writer`; false when it was refused (no such database, or the lock rule). */
export function saveAutomations(dbId: ID, list: Automation[], writer: Writer): boolean {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db) return false
  const next = readAutomations(list)
  if (db.locked && lockRefusal(readAutomations(db.automations), next)) return false
  const kept = unreadableAutomations(db.automations).filter((x) => !next.some((a) => a.id === x.id))
  withWriter(writer, () => s.updateDatabase(dbId, { automations: kept.length ? [...next, ...(kept as unknown as Automation[])] : next }))
  return true
}
