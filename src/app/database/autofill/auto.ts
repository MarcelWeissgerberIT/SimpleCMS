/**
 * AI autofill — "Re-fill automatically" from outside the property's panel (the Patchbay's key 1 for an autofill fuse,
 * "Autofill by hand only", §1.9), and the way to the panel from outside the database area.
 *
 * setAutofillAuto writes `auto` through the store under the caller's writer (the Patchbay: `you~patchbay`, its Undo
 * `you~undo`) and keeps the rest of the config — the fill records included; refused on a locked or read-only database,
 * a property without an autofill config, or one gone (§6 A20).
 */
import type { AutofillConfig, ID } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { openPage } from '../../lib/router'
import { isDbReadOnly } from '../readonly'
import { openAutofillPanel } from './store'

/** Switch a property's automatic re-fill on or off; false = refused (locked / read-only database, no autofill config). */
export function setAutofillAuto(dbId: ID, propId: ID, on: boolean): boolean {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  if (!db || !prop?.autofill || db.locked || isDbReadOnly()) return false
  if (!!prop.autofill.auto === on) return true
  const { auto: _was, ...rest } = prop.autofill
  void _was
  const next: AutofillConfig = on ? { ...rest, auto: true } : rest
  s.updateProperty(dbId, propId, { autofill: next })
  return true
}

/** Open a database page with a property's autofill panel (its settings and review) — the Patchbay's ↵ on an autofill module. */
export function openAutofill(dbId: ID, propId: ID): void {
  openPage(dbId)
  openAutofillPanel(dbId, propId)
}
