/**
 * AI autofill — "update automatically when the page changes".
 *
 * While the app is open, watches the store for changed rows of databases that have an
 * auto-updating autofill property. A few seconds after a row stops changing, each such property is
 * re-filled — but only if the row's fingerprint differs from the one recorded at the last fill
 * (so writing the result, or edits to other AI properties, never trigger another run).
 * Changes applied from other tabs are ignored (that tab runs its own watcher), and so are bulk
 * changes (imports, restores, bulk edits), which would otherwise fan out into dozens of paid calls.
 * Results are written directly; failures show on the cell.
 */
import type { Database, ID, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import { autofillOf, configIssue } from './config'
import { rowHash } from './context'
import { cellKey, fillRow, hasKey, jobKey, recordFills, setCells, useAutofill, writeProposal } from './store'

const QUIET_MS = 4000
const BULK = 25
const PARALLEL = 2

let started = false
const timers = new Map<ID, number>()
const queue = new Map<string, { dbId: ID; propId: ID; rowId: ID }>()
const inflight = new Set<string>()

let autoCache: { databases: Record<ID, Database>; ids: Set<ID> } | null = null
function autoDatabases(databases: Record<ID, Database>): Set<ID> {
  if (autoCache?.databases === databases) return autoCache.ids
  const ids = new Set<ID>()
  for (const db of Object.values(databases)) if (db.properties.some((p) => autofillOf(p)?.auto)) ids.add(db.id)
  autoCache = { databases, ids }
  return ids
}

/** Start the watcher (idempotent). */
export function startAutofillWatch(): void {
  if (started) return
  started = true
  useWorkspace.subscribe((s, prev) => {
    if (s.pages === prev.pages || isApplyingRemote()) return
    const dbs = autoDatabases(s.databases)
    if (!dbs.size) return
    const changed: Array<{ dbId: ID; rowId: ID }> = []
    for (const id in s.pages) {
      const p = s.pages[id]
      if (!p.databaseId || p.trashed || p === prev.pages[id] || !dbs.has(p.databaseId)) continue
      changed.push({ dbId: p.databaseId, rowId: id })
      if (changed.length > BULK) return
    }
    for (const c of changed) schedule(c.dbId, c.rowId)
  })
}

function schedule(dbId: ID, rowId: ID) {
  window.clearTimeout(timers.get(rowId))
  timers.set(
    rowId,
    window.setTimeout(() => {
      timers.delete(rowId)
      check(dbId, rowId)
    }, QUIET_MS),
  )
}

/** Queue the auto properties of a row whose inputs changed since their last fill. */
function check(dbId: ID, rowId: ID) {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const row = s.pages[rowId]
  if (!db || !row || row.trashed || row.databaseId !== dbId || !hasKey()) return
  // a brand-new, still empty row gives Claude nothing to go on
  if (!row.title.trim() && !(row.plain ?? '').trim()) return
  for (const prop of db.properties) {
    if (!isAuto(prop)) continue
    const cfg = autofillOf(prop)!
    if (cfg.fills?.[rowId]?.hash === rowHash(db, prop, row, cfg)) continue
    const job = useAutofill.getState().jobs[jobKey(dbId, prop.id)]
    if (job?.phase === 'running' && job.rows.includes(rowId)) continue
    queue.set(cellKey(prop.id, rowId), { dbId, propId: prop.id, rowId })
  }
  pump()
}

function isAuto(prop: PropertyDef): boolean {
  const cfg = autofillOf(prop)
  return !!cfg?.auto && !configIssue(prop, cfg)
}

function pump() {
  for (const [k, item] of queue) {
    if (inflight.size >= PARALLEL) return
    if (inflight.has(k)) continue
    queue.delete(k)
    void run(k, item)
  }
}

async function run(k: string, { dbId, propId, rowId }: { dbId: ID; propId: ID; rowId: ID }) {
  inflight.add(k)
  setCells({ [k]: { state: 'running' } })
  try {
    const p = await fillRow(dbId, propId, rowId, new AbortController().signal)
    const prop = useWorkspace.getState().databases[dbId]?.properties.find((x) => x.id === propId)
    if (!p || !prop || !isAuto(prop)) {
      setCells({ [k]: null })
      return
    }
    if (p.status === 'error') {
      setCells({ [k]: { state: 'error', message: p.error ?? '' } })
      return
    }
    if (p.status === 'same' || (p.status === 'pending' && writeProposal(dbId, propId, p))) recordFills(dbId, propId, { [rowId]: { at: Date.now(), hash: p.hash } })
    setCells({ [k]: null })
  } catch {
    setCells({ [k]: null })
  } finally {
    inflight.delete(k)
    pump()
  }
}
