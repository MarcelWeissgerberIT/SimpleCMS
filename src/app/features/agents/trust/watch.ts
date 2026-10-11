/**
 * Per-field trust — the "edited" watcher: a proposal the person applied on its own and then changed themselves within
 * 10 minutes (this tab) was not right as it was: its `accept` verdict becomes `edited`.
 *  - a field (update_row): the person's write changes that property to a value other than the one stored right after
 *    the apply (stable JSON); a row (create_row): the person changes its title or any property;
 *  - the person = their own edit of the value: a write framed `you` through the UI or the agenda (no via, 'ui',
 *    'agenda'), `editor`, or no frame inside a person's input event — never an Undo, nor what works for them after a
 *    press (the Outbox's row patch after "Mark as sent", a button's or a command's actions, a template, people merges,
 *    memory, setup …), never an automation, an agent, a sync, another member;
 *  - in memory, this tab only (lost on reload); ONE store subscription while anything is watched, and per store update
 *    only the watched rows are looked at. It never writes the store — only the book (patchBook, async).
 */
import type { ID, Page, PropertyValue } from '../../../store/types'
import type { TrustKey } from '../../../store/autonomy'
import { useWorkspace } from '../../../store/store'
import { currentWriter, inPersonEvent, type YouVia } from '../../../store/writer'
import { patchBook } from './book'
import { TRUST } from './rules'
import { stableJson } from './stable'

export interface WatchItem {
  /** the accept verdict's id */
  verdict: string
  key: TrustKey
  /** the real row id */
  row: ID
  /** a field watch: the property and its value as stored right after the apply */
  prop?: ID
  value?: PropertyValue | null
  /** a row watch (create_row): its title right after the apply */
  title?: string
}

interface Watch {
  agentId: ID
  item: WatchItem
  /** stable JSON of the stored value (field watches) */
  base: string
  until: number
}

const watches = new Map<string, Watch>()
/** row id → verdict ids watching it */
const byRow = new Map<ID, Set<string>>()
let unsub: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const pending = new Set<Promise<unknown>>()

const MS = TRUST.EDIT_MIN * 60_000

/** The person's own value edits (`you` frames): typed or picked in a field, or a date moved in the agenda. */
const OWN_EDIT: ReadonlySet<YouVia | undefined> = new Set<YouVia | undefined>([undefined, 'ui', 'agenda'])

/** The person wrote this store update themselves (not an Undo, not anything working for them). */
function byPerson(): boolean {
  const w = currentWriter()
  if (!w) return inPersonEvent()
  return (w.kind === 'you' && OWN_EDIT.has(w.via)) || w.kind === 'editor'
}

function drop(id: string): void {
  const w = watches.get(id)
  if (!w) return
  watches.delete(id)
  const set = byRow.get(w.item.row)
  set?.delete(id)
  if (set && !set.size) byRow.delete(w.item.row)
}

function sweep(now = Date.now()): void {
  for (const [id, w] of watches) if (now > w.until) drop(id)
  settle()
}

/** Subscribe while anything is watched; a timer ends the watches that run out. */
function settle(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!watches.size) {
    unsub?.()
    unsub = null
    return
  }
  unsub ??= useWorkspace.subscribe(onStore)
  const next = Math.min(...[...watches.values()].map((w) => w.until))
  timer = setTimeout(() => sweep(), Math.max(0, next - Date.now()) + 50)
}

const rowChanged = (a: Page, b: Page) => a.title !== b.title || stableJson(a.properties) !== stableJson(b.properties)

function onStore(state: { pages: Record<ID, Page> }, prev: { pages: Record<ID, Page> }): void {
  if (state.pages === prev.pages || !byRow.size) return
  let person: boolean | null = null
  const now = Date.now()
  for (const [row, ids] of [...byRow]) {
    const next = state.pages[row]
    const before = prev.pages[row]
    if (next === before || !next || !before) continue
    for (const id of [...ids]) {
      const w = watches.get(id)
      if (!w) continue
      if (now > w.until) {
        drop(id)
        continue
      }
      const it = w.item
      let changed: boolean
      if (it.prop) {
        const was = stableJson(before.properties[it.prop] ?? null)
        const is = stableJson(next.properties[it.prop] ?? null)
        changed = was !== is && is !== w.base
      } else changed = rowChanged(before, next)
      if (!changed) continue
      person ??= byPerson()
      if (!person) continue
      drop(id)
      mark(w)
    }
  }
  settle()
}

function mark(w: Watch): void {
  const job = patchBook(w.agentId, [w.item.key], (b) => {
    let hit = false
    b.entries[w.item.key] = (b.entries[w.item.key] ?? []).map((v) => (v.id === w.item.verdict && v.v === 'accept' ? ((hit = true), { ...v, v: 'edited' as const }) : v))
    return hit ? b : null
  })
  pending.add(job)
  void job.finally(() => pending.delete(job))
}

/** Watch accepted proposals for the person's own edits (10 minutes, this tab). */
export function watchAccepted(agentId: ID, items: WatchItem[]): void {
  const now = Date.now()
  for (const item of items) {
    if (!item.verdict || !item.row) continue
    drop(item.verdict)
    watches.set(item.verdict, { agentId, item, base: stableJson(item.value ?? null), until: now + MS })
    const set = byRow.get(item.row) ?? new Set<string>()
    byRow.set(item.row, set.add(item.verdict))
  }
  settle()
}

/** Stop watching these verdicts (their decision was undone). */
export function unwatch(verdicts: string[]): void {
  for (const id of verdicts) drop(id)
  settle()
}

/** e2e seam: end the watches that ran out and wait for the book writes under way; resolves with the watches left. */
export async function flushWatch(): Promise<number> {
  sweep()
  await Promise.all([...pending])
  return watches.size
}
