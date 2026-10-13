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
 * At the Regler's red line (features/governor) a fill is refused before anything is sent: that row and every row still
 * queued are paused — persisted with the change that caused them, so a reload keeps them — and the watch waits. They
 * are filled again on a new day, when a line moves (a raised budget) or with E in the panel (+1 $ for the watch's
 * fills of that property, today); a row whose inputs no longer differ from its last fill is dropped then. Resumed fills
 * are written as the autofill with the stored cause, never as the person.
 */
import type { Database, ID, PropertyDef } from '../../store/types'
import { pageChanges, useWorkspace } from '../../store/store'
import { isApplyingRemote } from '../../store/persistence'
import { causeKey, currentWriter, type Writer, type WriterKey } from '../../store/writer'
import { isEjectWriter } from '../../features/recorder/settled'
import { autofillOf, configIssue } from './config'
import { rowHash } from './context'
import { isDbReadOnly } from '../readonly'
import { cellKey, fillRow, hasKey, jobKey, loadFeatures, recordFills, setCells, useAutofill, writeProposal } from './store'

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
  // rows paused at the red line go again when a line moves or the day rolls (never at start: the day is not read yet)
  void loadFeatures().then((api) => api.onLineChange(() => resumeAutofill()), () => {})
  useWorkspace.subscribe((s, prev) => {
    if (s.pages === prev.pages || isApplyingRemote()) return
    // a source an eject put back is not filled again (it would spend tokens and write over the reverted value)
    if (isEjectWriter(currentWriter())) return
    const dbs = autoDatabases(s.databases)
    if (!dbs.size) return
    const changed: Array<{ dbId: ID; rowId: ID }> = []
    for (const id of pageChanges(s.pages, prev.pages).changed) {
      const p = s.pages[id]
      if (!p.databaseId || p.trashed || !dbs.has(p.databaseId)) continue
      changed.push({ dbId: p.databaseId, rowId: id })
      if (changed.length > BULK) return
    }
    // the write that changed the rows (store/writer.ts): the cause of their auto fills — read inside the listener
    const cause = causeKey()
    for (const c of changed) schedule(c.dbId, c.rowId, cause)
  })
}

/** Per row: the writer of the newest change that queued it (its fills' cause). */
const causes = new Map<ID, WriterKey>()

function schedule(dbId: ID, rowId: ID, cause: WriterKey) {
  causes.set(rowId, cause)
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
  if (!db || !row || row.trashed || row.databaseId !== dbId || !hasKey() || isDbReadOnly()) return
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
    // the watch: background work ('trigger' — at the red line it pauses, never asks); its fills of a property today are
    // one job (E in the panel allows them, features/governor watchSource)
    const api = await loadFeatures()
    const src = api.watchSource(dbId, propId)
    const p = await fillRow(dbId, propId, rowId, new AbortController().signal, { mode: 'trigger', job: src.slice(src.lastIndexOf(':') + 1) })
    const prop = useWorkspace.getState().databases[dbId]?.properties.find((x) => x.id === propId)
    if (!p || !prop || !isAuto(prop)) {
      setCells({ [k]: null })
      return
    }
    if (p.brake) {
      pauseQueue(api, { dbId, propId, rowId })
      return
    }
    if (p.status === 'error') {
      setCells({ [k]: { state: 'error', message: p.error ?? '' } })
      return
    }
    const writer: Writer = { kind: 'autofill', db: dbId, prop: propId, cause: causes.get(rowId) ?? 'unknown' }
    if (p.status === 'same' || (p.status === 'pending' && writeProposal(dbId, propId, p, writer) !== undefined)) recordFills(dbId, propId, { [rowId]: { at: Date.now(), hash: p.hash } })
    setCells({ [k]: null })
  } catch {
    setCells({ [k]: null })
  } finally {
    inflight.delete(k)
    pump()
  }
}

/* ------------------------------------------------------------------ */
/* The Regler's red line: paused rows                                   */
/* ------------------------------------------------------------------ */

type Features = Awaited<ReturnType<typeof loadFeatures>>

/** A fill was refused at the line: it and every queued row wait (persisted with their causes); nothing more is sent. */
function pauseQueue(api: Features, first: { dbId: ID; propId: ID; rowId: ID }) {
  const rows = [first, ...queue.values()]
  queue.clear()
  api.pauseRows(rows.map((r) => ({ db: r.dbId, prop: r.propId, row: r.rowId, cause: causes.get(r.rowId) ?? null })))
  setCells(Object.fromEntries(rows.map((r) => [cellKey(r.propId, r.rowId), null])))
  useAutofill.setState((s) => ({ paused: s.paused + 1 }))
}

/**
 * Fill the paused rows again (all, a database, a property): each is checked as a fresh change (a row whose inputs no
 * longer differ from its last fill is dropped) and written with the cause stored with it. `allow`: E in the panel —
 * +1 $ for the watch's fills of that property, today.
 */
export function resumeAutofill(match: { db?: ID; prop?: ID } = {}, allow = false): void {
  void loadFeatures().then((api) => {
    if (allow && match.db && match.prop) api.allowTask(api.watchSource(match.db, match.prop), api.ALLOW_USD)
    const rows = api.takeRows(match)
    if (!rows.length) return
    for (const r of rows) causes.set(r.row, (r.cause as WriterKey | null) ?? 'unknown')
    for (const r of rows) check(r.db, r.row)
    useAutofill.setState((s) => ({ paused: s.paused + 1 }))
  }, () => {})
}
