/**
 * AI autofill — "Re-fill automatically" from outside the property's panel (the Patchbay's key 1 for an autofill fuse,
 * "Autofill by hand only", §1.9), and the way to the panel from outside the database area.
 *
 * B1 (Patchbay seams): setAutofillAuto is the typed writer only — it refuses everything (false) until B10 fills it
 * (`auto` written through the store under the caller's writer; refused on a locked or read-only database, §6 A20).
 */
import type { ID } from '../../store/types'
import { openPage } from '../../lib/router'
import { openAutofillPanel } from './store'

/** Switch a property's automatic re-fill on or off; false = refused (B10 fills the body — until then always refused). */
export function setAutofillAuto(dbId: ID, propId: ID, on: boolean): boolean {
  return false
}

/** Open a database page with a property's autofill panel (its settings and review) — the Patchbay's ↵ on an autofill module. */
export function openAutofill(dbId: ID, propId: ID): void {
  openPage(dbId)
  openAutofillPanel(dbId, propId)
}
