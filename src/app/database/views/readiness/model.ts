/** Presentation over ordinary database cells; this tracker never grants access or runs a check. */
import type { Database, Page, ReadinessConfig } from '../../../store/types'
export const CHECKS = ['one', 'atlas', 'worker', 'copilot', 'repo'] as const
export type Check = typeof CHECKS[number]
export type CheckState = 'open' | 'ready' | 'blocked' | 'na'
export type Overall = 'open' | 'ready' | 'blocked' | 'later'
export function readReadiness(db: Database): ReadinessConfig | null {
  const c = db.readiness
  if (!c || c.v !== 1 || !c.checks) return null
  const type = (id: string | undefined, expected: string) => !!id && db.properties.some(p => p.id === id && p.type === expected)
  if (!CHECKS.every(k => type(c.checks[k], 'select') && ['open','ready','blocked','na'].every(value => db.properties.find(p => p.id === c.checks[k])?.options?.some(o => o.id === value)))) return null
  if (![c.role, c.participation].every(id => type(id, 'select'))) return null
  if (![c.blocker, c.next, c.owner, c.note, c.changedAt, c.changedBy].every(id => type(id, 'text'))) return null
  const ids = [...CHECKS.map(k => c.checks[k]), c.role, c.participation, c.blocker, c.next, c.owner, c.note, c.changedAt, c.changedBy]
  return new Set(ids).size === ids.length ? c : null
}
export function participant(row: Pick<Page, 'properties'>, c: ReadinessConfig) {
  const guest = row.properties[c.role] === 'guest'
  const later = row.properties[c.participation] === 'later'
  const required: readonly Check[] = guest ? ['one', 'atlas'] : CHECKS
  const states = Object.fromEntries(CHECKS.map(k => {
    const v = row.properties[c.checks[k]]
    // A required check cannot turn green by choosing "not needed" or an unknown value.
    return [k, later || !required.includes(k) ? 'na' : v === 'ready' || v === 'blocked' ? v : 'open']
  })) as Record<Check, CheckState>
  const done = required.filter(k => states[k] === 'ready').length
  const overall: Overall = later ? 'later' : required.some(k => states[k] === 'blocked') ? 'blocked' : done === required.length ? 'ready' : 'open'
  return { guest, later, required, states, done, total: required.length, overall }
}
