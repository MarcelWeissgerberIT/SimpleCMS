/**
 * Work orders — who last wrote a request's title and fields, per field (review Fix 2, spec §2.3 / §3.5 / A11).
 *
 * A row's body carries its writer in `contentOrigin`, and agents stamp `updatedBy` — but the MCP bridge, the AI
 * terminal's applied `create_row` / `update_row`, scripts, automations, templates, imports … leave no trace on the page
 * when they write a request's TITLE or its FIELDS (the planner reads both: `<request title=…>` + `fields`). This module
 * keeps that trace on this device:
 *  - the trigger subscriber (trigger.ts) calls `noteRowWrite` inside the store listener (the writer frame of the write is
 *    still open): per changed field the last writer — the person (`you` via none / 'ui' / 'command', an editor) clears
 *    the field's mark, anyone else sets it (`by` = the writer's kind); a row made by someone other than the person marks
 *    its title, every filled field and `made` (its body without a content origin is then not the person's either);
 *  - the Status is left out (only the person's drag and One's own order writer may write it — status.ts guards);
 *    system bookkeeping, the order writer, an eject / rewind, a replay of another tab (that tab records it) and a change
 *    from the server (a team: the work orders are private — no auto mode there) change nothing;
 *  - kept per scope in IndexedDB `one-coding` (`<scope>|orderby|<rowId>`; never synced, exported or backed up; wiped with
 *    the device copy and the local reset — both clear `one-coding`), and in this tab's memory for the synchronous read at
 *    the press (`rowOutsideNow`); a press loads it again (`loadRowOutside`) before it plans.
 * `outsideOf(marks, row)` names the writer that makes the row "outside" for auto mode and the FREMD tag (autoCore.ts
 * provOutside reads it from the press's provenance, `OrderProv.outside`).
 */
import { createStore, del, get, update, type UseStore } from 'idb-keyval'
import type { Database, ID, Page } from '../../../store/types'
import { orderScope } from './records'
import { nextMarks, readRowOutside, type OutsideMark, type RowOutside } from './rowMarks'

export { markOf, outsideOf, PERSON_FIELD_VIAS, type OutsideMark, type RowOutside } from './rowMarks'

/* ------------------------------------------------------------------ this tab + IndexedDB */

const mem = new Map<string, RowOutside | undefined>()
/** rows whose stored marks this tab has read (or written): a person's write over no marks then needs no store write */
const known = new Set<string>()
const memKey = (rowId: ID, s = orderScope()) => `${s}|${rowId}`
const keyOf = (rowId: ID, s = orderScope()) => `${s}|orderby|${rowId}`

let db: UseStore | null = null
let noDb = false
const kv = (): UseStore | null => {
  if (noDb || typeof indexedDB === 'undefined') return null
  return (db ??= createStore('one-coding', 'kv'))
}

/** A row's marks as this tab holds them now (synchronous: the press reads them inside the store listener). */
export const rowOutsideNow = (rowId: ID): RowOutside | undefined => mem.get(memKey(rowId))

/** A row's marks, read from storage now (merged into this tab's: a mark set here and not stored yet stays). */
export async function loadRowOutside(rowId: ID): Promise<RowOutside | undefined> {
  const s = orderScope()
  const store = kv()
  let stored: RowOutside | undefined
  if (store)
    try {
      stored = readRowOutside(await get(keyOf(rowId, s), store))
    } catch {
      noDb = true
    }
  const here = mem.get(memKey(rowId, s))
  const merged = merge(stored, here)
  mem.set(memKey(rowId, s), merged)
  known.add(memKey(rowId, s))
  return merged
}

/** Two copies of a row's marks: per field the newer mark wins (a field one cleared stays cleared only where it was). */
function merge(a: RowOutside | undefined, b: RowOutside | undefined): RowOutside | undefined {
  if (!a) return b
  if (!b) return a
  const newer = (x?: OutsideMark, y?: OutsideMark) => (!x ? y : !y ? x : x.at >= y.at ? x : y)
  const props = { ...(a.props ?? {}) }
  for (const [id, m] of Object.entries(b.props ?? {})) props[id] = newer(props[id], m)!
  const out: RowOutside = {}
  const title = newer(a.title, b.title)
  if (title) out.title = title
  const made = newer(a.made, b.made)
  if (made) out.made = made
  if (Object.keys(props).length) out.props = props
  return out.title || out.props || out.made ? out : undefined
}

/**
 * Record one write of a request row (see the head of this file) — called synchronously from the store listener; the
 * stored copy follows (compare-and-set: two tabs never lose each other's marks).
 */
export function noteRowWrite(rowId: ID, db: Database, now: Page, before: Page | undefined, who: 'person' | string): void {
  const s = orderScope()
  const k = memKey(rowId, s)
  const at = Date.now()
  const prev = mem.get(k)
  const next = nextMarks(prev, db, now, before, who, at)
  // the same object: nothing changed — except a person's write over marks this tab has not read (stored ones are cleared)
  if (next === prev && (prev !== undefined || who !== 'person' || !before || known.has(k))) return
  mem.set(k, next)
  // a row made here holds nothing older
  if (!before) known.add(k)
  const store = kv()
  if (!store) return
  let gone = false
  void update(
    keyOf(rowId, s),
    (raw: unknown) => {
      const stored = nextMarks(readRowOutside(raw), db, now, before, who, at)
      gone = !stored
      return stored ?? undefined
    },
    store,
  )
    .then(() => (gone ? del(keyOf(rowId, s), store) : undefined))
    .then(() => (known.has(k) || orderScope() !== s ? undefined : loadRowOutside(rowId)))
    .catch(() => {
      noDb = true
    })
}
