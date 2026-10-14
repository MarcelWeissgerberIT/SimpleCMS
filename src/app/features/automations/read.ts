/**
 * Automations — the reader (pure, no store: Node specs and the Patchbay's model use it). Every reader of
 * `Database.automations` goes through readAutomations (Workspace › Automation, the Patchbay; B15 moves
 * AutomationsModal and the engine onto it).
 *
 * B1 (Patchbay seams): a typed pass-through — a list stays the list it is, anything else reads as none.
 * B15 fills the sanitizer (§1.14): trigger, actions, the webhook URL (https / http only) and method checked.
 */
import type { Automation } from '../../store/types'

/** A database's automations as every reader takes them (B15: sanitized). */
export function readAutomations(raw: unknown): Automation[] {
  return Array.isArray(raw) ? (raw as Automation[]) : []
}
