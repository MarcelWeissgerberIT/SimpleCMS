/**
 * The morning hold: on the first boot of a Preflight day, `bootRedirect` stays on "#/" (the plate) instead of jumping
 * to the start page — when this device's preference holds and lamps were lit at the last count. Synchronous,
 * localStorage only. The day is consumed by its first call, whatever it answers: a second boot the same day goes to
 * the start page as always. Deep links are never held (bootRedirect asks only for "#/").
 */
import { activeWorkspace } from '../../cloud'
import { preflightDay } from './day'
import { readLast, readLastScope, readPrefs, readTodayAny, writeToday } from './prefs'
import { scopeKey, workspaceRef } from './scope'

/** The member scope now, else the one this workspace used last (the account is not known before the cloud boot ends). */
function bootScope(): string | null {
  return scopeKey() ?? readLastScope(workspaceRef(activeWorkspace()))
}

export function preflightHoldsStart(now = Date.now()): boolean {
  const p = readPrefs()
  if (p.on === false) return false
  const scope = bootScope()
  if (!scope) return false
  const day = preflightDay(now, p.at)
  const rec = readTodayAny(scope)
  if (rec && rec.day === day && rec.held) return false
  writeToday(scope, rec && rec.day === day ? { ...rec, held: true } : { day, held: true, base: [] })
  if (p.hold === false) return false
  const last = readLast(scope)
  return !!last && last.lamps.some(([, level]) => level === 'amber' || level === 'red')
}
