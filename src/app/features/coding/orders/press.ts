/**
 * Work orders — a press (spec §0 / §1.3 / §3.1, B4): the ONE way to the planner. Only the fixed allow-list calls it,
 * in this tab: the Status → Planen by the person (trigger.ts), the database command Planen, ↵ Planen on the plate,
 * Prüfen lassen (send.ts). Nothing else ever plans.
 *
 *  1. The provenance is captured synchronously at the press (`pressProv`: the row and its first 8 linked pages — who
 *     made / last changed them, their content origin and revision), from the state BEFORE the write that pressed
 *     (trigger.ts passes `prev`: the attribution keeper may clear an agent's stamp right after it).
 *  2. §2.2 items 1–6 (pre.ts over preconditions.ts, from facts.ts — the planner re-checks the same) decide:
 *     - ok → the Status moves to Planen (order writer `#s`) and the planner runs (plan.ts planOrder → planner.ts, mode
 *       'manual', with the press's run and provenance — callPlanner);
 *     - Coding off / the worker away / outdated / unsafe → the press is KEPT on this device (the record's `want`, with
 *       its provenance); the Status moves to Planen; it plans 5 s after an 'ok' worker is online here (trigger.ts), in
 *       mode 'trigger', within 24 h — then it expires ("abgelaufen — ↵ erneut");
 *     - anything else (a viewer, the worker on another device, no repo, no usable project) → nothing is written; the
 *       plate names the reason (`usePressNotes`).
 *  3. A chain that runs is never planned over ("Kette läuft — erst anhalten").
 */
import { create } from 'zustand'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { ID, Page } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import { newId } from '../../../lib/ids'
import { useUI } from '../../../store/ui'
import { t } from '../../../i18n'
import { refIdsIn } from '../refs'
import { orderStatusKey, writeOrderStatus } from './db'
import { kindProjects, requestFacts } from './facts'
import { orderPre, type OrderPreFacts, type OrderPreKind, type OrderPreResult, type OrderPreWhy } from './pre'
import { patchOrderRecord } from './records'
import { planOrder } from './plan'
import type { PlanOutcome } from './planner'
import { pageShown, requestNow, shownFp, textFp } from './fingerprint'
import { ORDER_LIMITS, type OrderPress, type OrderPressHow, type OrderProv } from './types'

const ws = () => useWorkspace.getState()

/* ------------------------------------------------------------------ provenance */

const provOf = (p: Page): OrderProv => ({ createdBy: p.createdBy ?? null, updatedBy: p.updatedBy ?? null, contentOrigin: p.contentOrigin ?? null, contentRev: p.contentRev ?? 0 })

/**
 * Who wrote the request and the pages it links, as they stand in `pages` (the state before the press's own write): the
 * row and its first 8 live linked pages (mentions, page links, One addresses — coding/refs.ts), each with its revision.
 */
export function pressProv(pages: Record<ID, Page>, rowId: ID): { prov: Record<ID, OrderProv>; pins: Record<ID, number> } {
  const row = pages[rowId]
  const prov: Record<ID, OrderProv> = {}
  const pins: Record<ID, number> = {}
  if (!row) return { prov, pins }
  prov[rowId] = provOf(row)
  pins[rowId] = row.contentRev ?? 0
  let n = 0
  for (const id of refIdsIn(row.content?.content ?? [], rowId)) {
    if (n >= ORDER_LIMITS.linkedPages) break
    const p = pages[id]
    if (!p || p.trashed || isEffectivelyTrashed(pages, id) || inTemplate(pages, id)) continue
    prov[id] = provOf(p)
    pins[id] = p.contentRev ?? 0
    n++
  }
  return { prov, pins }
}

/**
 * Orders B11: what the press saw, as fingerprints (orders/fingerprint.ts — the request as every step quotes it, each
 * linked page as title + text): read NOW, synchronously, hashed afterwards. Auto mode falls back when the planner read
 * something else ("moved since the press"); a fingerprint ignores block ids, so an editor filling them is no change.
 */
function pressShown(rowId: ID, ids: readonly ID[]): () => Promise<Record<ID, string>> {
  const s = ws()
  const request = s.pages[rowId] ? requestNow(rowId).text : null
  const pages = ids.filter((id) => id !== rowId && !!s.pages[id]).map((id) => [id, pageShown(s.pages[id])] as const)
  return async () => {
    const out: Record<ID, string> = {}
    try {
      if (request !== null) out[rowId] = await textFp(request)
      for (const [id, shown] of pages) out[id] = await shownFp(shown)
    } catch {
      return {}
    }
    return out
  }
}

/* ------------------------------------------------------------------ the preconditions here */

/** The kinds a request may use, each with its project and problem (facts.ts — the planner reads the same). */
export const preKinds = (rowId: ID): OrderPreKind[] => kindProjects(rowId).map(({ kind, project, problem }) => ({ kind, project, problem }))

/** §2.2 items 1–6 as this tab sees them now (facts.ts requestFacts — the planner's re-check reads the same facts). */
export function orderPreFacts(rowId: ID): OrderPreFacts {
  const f = requestFacts(rowId)
  return { ...f, kinds: f.kinds.map(({ kind, project, problem }) => ({ kind, project, problem })) }
}

export const orderPreNow = (rowId: ID): OrderPreResult => orderPre(orderPreFacts(rowId))

/* ------------------------------------------------------------------ what the plate says after a press */

export interface PressNote {
  why: OrderPreWhy | 'running' | 'gone' | 'planning'
  at: number
  left: OrderPreKind[]
}

/** The last press outcome per row in this tab (the plate's strip; a press that planned clears it). */
export const usePressNotes = create<{ notes: Record<ID, PressNote> }>(() => ({ notes: {} }))
export const setPressNote = (rowId: ID, n: PressNote | null) =>
  usePressNotes.setState((s) => {
    const notes = { ...s.notes }
    if (n) notes[rowId] = n
    else delete notes[rowId]
    return { notes }
  })

/* ------------------------------------------------------------------ pressing */

export type PressResult =
  | { kind: 'planning' }
  /** kept on this device: plans when an 'ok' worker is back here */
  | { kind: 'kept'; why: OrderPreWhy }
  | { kind: 'refused'; why: OrderPreWhy | 'running' | 'gone'; left: OrderPreKind[] }

/** The order writer of a request's Status (`order:<row>:<run>#s`). */
export const statusWriter = (rowId: ID, run: string): Writer => ({ kind: 'order', row: rowId, run, change: 's' })

/** Is this a live request row (not trashed, its database a live work-orders one)? */
function liveRow(rowId: ID): boolean {
  const s = ws()
  const row = s.pages[rowId]
  return !!row?.databaseId && !row.trashed && !isEffectivelyTrashed(s.pages, rowId) && s.databases[row.databaseId]?.system === 'workorders'
}

/**
 * A press of the allow-list (see the head of this file). `captured`: the provenance taken at the press (trigger.ts:
 * from the state before the Status write) — default: now (the command, the plate, Prüfen lassen press before writing).
 */
export async function pressPlan(rowId: ID, how: OrderPressHow, opts: { captured?: ReturnType<typeof pressProv> } = {}): Promise<PressResult> {
  const captured = opts.captured ?? pressProv(ws().pages, rowId)
  if (!liveRow(rowId)) return { kind: 'refused', why: 'gone', left: [] }
  const shown = pressShown(rowId, Object.keys(captured.prov))
  const at = Date.now()
  const fps = await shown()
  const press: OrderPress = { run: newId(), at, how, ...captured, ...(Object.keys(fps).length ? { fps } : {}) }
  const status = orderStatusKey(rowId)
  // a chain that runs is halted first (H) — never planned over (the drag rules put such a press back, trigger.ts)
  if (status === 'running') {
    setPressNote(rowId, { why: 'running', at: press.at, left: [] })
    return { kind: 'refused', why: 'running', left: [] }
  }
  const pre = orderPreNow(rowId)
  if (!pre.ok && !pre.want) {
    setPressNote(rowId, { why: pre.why, at: press.at, left: pre.left })
    return { kind: 'refused', why: pre.why, left: pre.left }
  }
  if (status !== 'plan') writeOrderStatus(rowId, 'plan', statusWriter(rowId, press.run))
  if (!pre.ok) {
    // kept on this device: the want carries the press (its provenance) — a newer press replaces an older one
    await patchOrderRecord(rowId, (rec) => ({ ...(rec ?? { v: 1, state: 'draft' }), want: { at: press.at, mode: 'trigger', press } }))
    setPressNote(rowId, { why: pre.why, at: press.at, left: [] })
    return { kind: 'kept', why: pre.why }
  }
  // planning now: an older kept press of this row is spent
  await patchOrderRecord(rowId, (rec) => (rec?.want ? dropWant(rec) : rec))
  setPressNote(rowId, { why: 'planning', at: press.at, left: pre.left })
  void callPlanner(rowId, 'manual', press)
  return { kind: 'planning' }
}

/**
 * Every call this tab makes into the planner (DEV / `?e2e`: the entries' seam reads it — orders/entrySeam.ts), then the
 * planner (orders/plan.ts planOrder → planner.ts, lazy). "plant schon" when it plans this request already.
 */
export const pressLog: Array<{ rowId: ID; mode: 'manual' | 'trigger'; how: OrderPressHow; run: string; at: number; prov: string[] }> = []

/**
 * The press into the planner: its run (the Planen write's run — the planner's Status write and its ledger source
 * `order:<row>:<run>` carry the same) and the provenance captured at the press. Once the planner has returned, the
 * press's "planning" note goes — the plate reads the run itself from then on (runs.ts usePlannerRun: its phase, how it
 * ended). Resolves the outcome's kind (null: it threw).
 */
export function callPlanner(rowId: ID, mode: 'manual' | 'trigger', press: OrderPress): Promise<PlanOutcome['kind'] | null> {
  pressLog.push({ rowId, mode, how: press.how, run: press.run, at: Date.now(), prov: Object.keys(press.prov) })
  if (pressLog.length > 200) pressLog.splice(0, pressLog.length - 200)
  return planOrder(rowId, { mode, prov: press.prov, run: press.run, ...(press.fps ? { pressFps: press.fps } : {}) })
    .then(async (out): Promise<PlanOutcome['kind']> => {
      if (out.kind === 'busy') useUI.getState().toast({ message: t('features.coding.order.why.busy'), kind: 'info' })
      // Orders B11: "Ohne Bestätigung starten" on this device — the finished plan starts at once unless anything is
      // unclear (autoStart.ts; nothing without the consent)
      if (out.kind === 'ready') await autoAfter(rowId, out.run)
      return out.kind
    })
    .catch(() => null)
    .finally(() => {
      if (usePressNotes.getState().notes[rowId]?.why === 'planning') setPressNote(rowId, null)
    })
}

/** Orders B11: the press's plan in auto mode (lazy — the consent is read there; without one nothing happens). */
export const autoAfter = (rowId: ID, run: string): Promise<unknown> =>
  import('./autoStart').then((m) => m.autoAfterPlan(rowId, run)).catch(() => null)

/** The record without its want (a record that held nothing else is removed). */
export function dropWant<R extends { v: 1; state: string; want?: unknown; draft?: unknown; chain?: unknown }>(rec: R): R | null {
  const { want: _w, ...rest } = rec
  return !rest.draft && !rest.chain && rest.state === 'draft' ? null : (rest as R)
}

/** Is a kept press still in time (≤ 24 h)? */
export const wantLive = (want: { at: number } | undefined, now = Date.now()): boolean => !!want && now - want.at <= ORDER_LIMITS.wantMs
