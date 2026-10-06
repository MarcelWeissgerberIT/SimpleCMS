/**
 * Building blocks — computed values. A property of an own type with a `value` script is read-only: the
 * script (query mode, `row` in scope) computes its value and the result is written into the property
 * only when it differs (the store's row value action; writer 'kit'). When:
 *  - a cell of it shows (the visible rows of a view, a row page) — once per row per opening,
 *  - a row of the database changed (debounced) — never because of the kit's own writes,
 *  - the type's code or the database's properties changed (every row),
 *  - "Recompute values" (the property menu).
 * At most 500 rows per pass; the rest waits for the next one. Failing rows keep their value and show ⚠.
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import type { Database, ID, Page, PropertyDef, Workspace } from '../../store/types'
import { ownTypeOf } from './model'
import { runBinding, useKitTrust } from './scripts'
import { sameValue, storedValueOf, ValueMisfit } from './values'

export const KIT_WRITER = 'kit'
export const PASS_MAX = 500
const DEBOUNCE = 400

const ws = () => useWorkspace.getState()

/** Cells whose last computation (or format script) failed: `${rowId}|${propId}` → message. */
export const useKitErrors = create<{ errors: Record<string, string> }>()(() => ({ errors: {} }))

export function setCellError(rowId: ID, propId: ID, msg: string | null): void {
  const key = `${rowId}|${propId}`
  const cur = useKitErrors.getState().errors[key]
  if ((cur ?? null) === msg) return
  useKitErrors.setState((s) => {
    const errors = { ...s.errors }
    if (msg) errors[key] = msg
    else delete errors[key]
    return { errors }
  })
}

/** The kit is writing computed values right now (its own store changes are not "a row changed"). */
let writing = 0
export const kitIsWriting = () => writing > 0

/** Value properties of a database: [prop, its own type's value code]. */
function valueProps(db: Database): PropertyDef[] {
  return db.properties.filter((p) => !!ownTypeOf(p)?.scripts?.value)
}

/* ------------------------------------------------------------------ queue */

/** `${dbId}|${propId}` → rows to compute */
const queue = new Map<string, Set<ID>>()
let timer: number | null = null
let busy = false
const waiters: Array<() => void> = []

function enqueue(dbId: ID, propId: ID, rowIds: Iterable<ID>): void {
  const key = `${dbId}|${propId}`
  const set = queue.get(key) ?? new Set<ID>()
  for (const id of rowIds) set.add(id)
  if (set.size) queue.set(key, set)
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void pass()
  }, DEBOUNCE)
}

const rowsOfDb = (dbId: ID): Page[] => Object.values(ws().pages).filter((p) => p.databaseId === dbId && !p.trashed)

/** Opened cells: compute once per row and property in this tab (until the code changes). */
const seen = new Map<string, string>()

/** A cell of a value property shows: compute that row (once per opening of the code). */
export function scheduleValue(dbId: ID, propId: ID, rowId: ID): void {
  const db = ws().databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  const code = prop ? ownTypeOf(prop)?.scripts?.value : undefined
  if (!code) return
  const key = `${rowId}|${propId}`
  if (seen.get(key) === code) return
  seen.set(key, code)
  enqueue(dbId, propId, [rowId])
}

/** "Recompute values": every row of the database for one property (≤ 500 per pass). Resolves with the number of changed values. */
export async function recomputeProperty(dbId: ID, propId: ID): Promise<number> {
  enqueue(dbId, propId, rowsOfDb(dbId).map((r) => r.id))
  return new Promise<number>((resolve) => {
    const before = changedTotal
    waiters.push(() => resolve(changedTotal - before))
  })
}

let changedTotal = 0

async function pass(): Promise<void> {
  if (busy) {
    enqueueLater()
    return
  }
  busy = true
  try {
    let budget = PASS_MAX
    for (const [key, rows] of [...queue]) {
      if (budget <= 0) break
      const [dbId, propId] = key.split('|')
      const ids = [...rows].slice(0, budget)
      ids.forEach((id) => rows.delete(id))
      if (!rows.size) queue.delete(key)
      budget -= ids.length
      await computeRows(dbId, propId, ids)
    }
  } finally {
    busy = false
  }
  if (queue.size) enqueueLater()
  else waiters.splice(0).forEach((w) => w())
}

function enqueueLater(): void {
  if (timer !== null) return
  timer = window.setTimeout(() => {
    timer = null
    void pass()
  }, DEBOUNCE)
}

async function computeRows(dbId: ID, propId: ID, rowIds: ID[]): Promise<void> {
  if (useCloud.getState().readOnly) return
  for (const rowId of rowIds) {
    const s = ws()
    const db = s.databases[dbId]
    const prop = db?.properties.find((p) => p.id === propId)
    const row = s.pages[rowId]
    const type = prop ? ownTypeOf(prop) : null
    if (!db || !prop || !type?.scripts?.value || !row || row.trashed || row.databaseId !== dbId) continue
    const r = await runBinding(type, 'value', { row, prop }, { mode: 'query' })
    if (!r || r === 'untrusted') continue
    if (!r.ok) {
      setCellError(rowId, propId, r.error)
      continue
    }
    // the store may have moved on while the script ran: write against the current state
    const now = ws()
    const db2 = now.databases[dbId]
    const prop2 = db2?.properties.find((p) => p.id === propId)
    const row2 = now.pages[rowId]
    if (!db2 || !prop2 || !row2 || ownTypeOf(prop2)?.scripts?.value !== type.scripts.value) continue
    try {
      const added: NonNullable<PropertyDef['options']> = []
      const value = storedValueOf(db2, prop2, r.plain, added)
      setCellError(rowId, propId, null)
      if (sameValue(row2.properties[propId], value)) continue
      writing++
      try {
        if (added.length) now.updateProperty(dbId, propId, { options: [...(prop2.options ?? []), ...added] })
        now.setRowProperty(rowId, propId, value)
        changedTotal++
      } finally {
        writing--
      }
    } catch (e) {
      setCellError(rowId, propId, e instanceof ValueMisfit ? e.message : String(e))
    }
  }
}

/* ------------------------------------------------------------------ the service */

/** A database's value properties with their code (to notice new properties and changed scripts). */
function signature(db: Database): string {
  return valueProps(db)
    .map((p) => `${p.id}:${ownTypeOf(p)?.scripts?.value ?? ''}`)
    .join('\n')
}

let stop: (() => void) | null = null

/** Start watching rows and code (main.tsx). Returns the stop function. */
export function startKit(): () => void {
  stop?.()
  const sigs = new Map<ID, string>()
  for (const db of Object.values(ws().databases)) sigs.set(db.id, signature(db))

  const unsubWs = useWorkspace.subscribe((s: Workspace, prev: Workspace) => {
    if (writing > 0) return
    // code or properties changed: every row of the affected databases
    if (s.databases !== prev.databases || s.kit !== prev.kit) {
      for (const db of Object.values(s.databases)) {
        const sig = signature(db)
        if (sigs.get(db.id) === sig) continue
        const before = new Set((sigs.get(db.id) ?? '').split('\n'))
        sigs.set(db.id, sig)
        const rows = rowsOfDb(db.id).map((r) => r.id)
        for (const p of valueProps(db)) if (!before.has(`${p.id}:${ownTypeOf(p)?.scripts?.value ?? ''}`)) enqueue(db.id, p.id, rows)
      }
    }
    // rows that changed (or were created): their value properties
    if (s.pages !== prev.pages) {
      const byDb = new Map<ID, PropertyDef[]>()
      for (const [id, p] of Object.entries(s.pages)) {
        if (prev.pages[id] === p || !p.databaseId || p.trashed) continue
        let props = byDb.get(p.databaseId)
        if (!props) {
          const db = s.databases[p.databaseId]
          props = db ? valueProps(db) : []
          byDb.set(p.databaseId, props)
        }
        for (const prop of props) enqueue(p.databaseId, prop.id, [id])
      }
    }
  })
  // another workspace: trust and errors start over
  let active = useCloud.getState().active
  const unsubCloud = useCloud.subscribe((c) => {
    if (c.active === active) return
    active = c.active
    useKitTrust.setState({ ok: {} })
    useKitErrors.setState({ errors: {} })
    seen.clear()
    queue.clear()
    sigs.clear()
    for (const db of Object.values(ws().databases)) sigs.set(db.id, signature(db))
  })
  stop = () => {
    unsubWs()
    unsubCloud()
    stop = null
  }
  return stop
}
