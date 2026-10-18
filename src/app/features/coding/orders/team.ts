/**
 * Work orders in a team (spec §3.10, Orders B12) — the pure rules (a Node spec reads them):
 *
 *  - `requestedElsewhere(rec, row, now)`: does a request standing in Planen wait for THIS device (the one with the worker
 *    link) because another device asked for it? Exact when this device saw the Planen arrive from the server
 *    (`OrderRecord.asked` — the member's own write: the work orders are private) and has not pressed or planned it since;
 *    when this device was away meanwhile (nothing seen arrive), only a request it knows nothing of at all, changed in
 *    the last 24 h. Never while a press is kept here, a chain is being made or runs here.
 *  - `ruleRefusal(code, fix, admin)`: how a data rule's refusal of the planner is said — a workspace rule a member
 *    cannot change: "Regel des Arbeitsbereichs — eine Admin kann sie ändern", without the change key ('member'); else
 *    the fix keys ('fix'); not a data rule: null.
 */
import { ORDER_LIMITS, type OrderRecord } from './types'

/** Classes a member decides for themselves (their private pages, mail, memory, their MCP servers) — features/ai/setup's rule. */
const MEMBER_CLASSES = new Set(['private', 'mail', 'memory', 'mcp'])

export function requestedElsewhere(rec: OrderRecord | null, row: { updatedAt: number }, now = Date.now()): boolean {
  // a press kept here, or a chain being made or running here: nothing to ask for
  if (rec?.want) return false
  if (rec && (rec.state === 'running' || rec.state === 'creating' || rec.state === 'interrupted')) return false
  const asked = rec?.asked?.at
  if (asked !== undefined) {
    if (now - asked > ORDER_LIMITS.wantMs) return false
    // pressed or planned here since: answered
    if (rec!.pressed !== undefined && rec!.pressed >= asked) return false
    if (rec!.state === 'draft' && rec!.draft && rec!.draft.at >= asked) return false
    return true
  }
  // nothing seen arrive: a request this device knows nothing of (no record), changed within a day
  if (rec) return false
  return now - row.updatedAt <= ORDER_LIMITS.wantMs
}

export function ruleRefusal(code: string | undefined, fix: { kind: string; step?: string; data?: string } | null | undefined, admin: boolean): 'member' | 'fix' | null {
  if (code !== 'policy') return null
  if (!fix || fix.kind !== 'step' || fix.step !== 'data') return null
  // a workspace class: only owners / admins change its rule — a member's own class is theirs to change
  return !admin && !MEMBER_CLASSES.has(fix.data ?? '') ? 'member' : 'fix'
}
