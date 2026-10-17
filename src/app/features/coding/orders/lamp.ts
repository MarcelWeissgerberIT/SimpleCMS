/**
 * Work orders in Preflight (spec §5 "Preflight", §3.4, §3.10 — B9): the reading of what waits on the person on this
 * device, the guard every key that lets the chain start something shares, and the chain chip of a coding card. Eager and
 * small — Preflight's built-in source (preflight/sources/orders.ts) reads it through coding/index.ts; its keys go through
 * Preflight's queue/calls.ts into the orders' own entry points (confirm.ts, chainKeys.ts, trigger.ts, press.ts).
 *
 * The cards — an id names what the card is about, so a change of that makes a new card:
 *  - 'ready'        Kette bereit: this device's plan with steps, the request in Kette bereit
 *                   (`order:<row>:ready@<draft hash 8>` — an edit of the plan is another card);
 *  - 'next'         Weiter mit Schritt n?: the chain engine's card for a chain running here
 *                   (`order:<row>:next:<n>@<run 8>:<reasons>`);
 *  - 'halted'       Kette angehalten — never one the person ended with Fertig (`order:<row>:halted@<at 36>`);
 *  - 'interrupted'  a creation a closed tab left half done (`order:<row>:interrupted@<run 8>`);
 *  - 'chainConfirm' a request in Läuft whose chain this device holds no record of — the worker moved here (a team), a
 *                   restored backup — while its steps carry the request (`order:<row>:chainConfirm@<ids 8>`); only on
 *                   the device with the worker link in a team;
 *  - 'request'      a team: the member's own request stands in Planen and was not pressed here (another device
 *                   asked) — on the worker device only (`order:<row>:request`).
 * Viewers get none. O(requests): this device's records (every one of the scope is read at start), the engine's moves,
 * the request rows from the shared row index; only a Läuft request without a record looks at its projects' rows.
 */
import { useWorkspace } from '../../../store/store'
import type { Database, ID } from '../../../store/types'
import { onRowsChanged, rowIdsOf } from '../../../store/rowIndex'
import { t } from '../../../i18n'
import { useCloud } from '../../../cloud'
import { useCoding } from '../state'
import { workerOnline, workerVerdict } from '../link'
import { codingProps, codingReadOnly, inTeam, pipelineDbIdsOf } from '../schema'
import { PIPELINE_KINDS, type PipelineKind } from '../stages'
import { orderCode, orderRowIds, orderStatusKey } from './db'
import { loadOrderRecord, orderScope, useOrderRecords } from './records'
import { useChainMoves } from './chainRun'
import { useOrderPlanner } from './runs'
import { usePressNotes } from './press'
import { onSeen } from './seen'
import type { OrderChain, OrderRecord } from './types'

const ws = () => useWorkspace.getState()

export type OrderCardKind = 'ready' | 'next' | 'chainConfirm' | 'halted' | 'request' | 'interrupted'

export interface OrderCard {
  /** the Preflight item id (see the head of this file) */
  id: string
  kind: OrderCardKind
  /** the request's row */
  row: ID
  /** when it appeared */
  at: number
  /** 'next': the step that would start */
  step?: number
}

/** A request in Läuft only counts as one without a chain here once its Status stood that long (another tab's write settles). */
const CONFIRM_SETTLE_MS = 10_000

/** The request row and kind of an orders card id (null: not one). */
export function parseOrderCard(id: string): { row: ID; kind: OrderCardKind } | null {
  const m = /^order:([^:]+):(ready|next|chainConfirm|halted|request|interrupted)(?:[@:]|$)/.exec(id)
  return m ? { row: m[1]!, kind: m[2] as OrderCardKind } : null
}

/**
 * Why a key that lets a chain start something cannot act on this device (null: it may) — the guard chainKeys.ts uses too:
 * a viewer never; a team only on the device with the worker link; never an outdated or unsafe worker.
 */
export function chainKeyBlock(): 'readOnly' | 'elsewhere' | 'outdated' | 'unsafe' | null {
  if (codingReadOnly()) return 'readOnly'
  if (inTeam() && !workerOnline()) return 'elsewhere'
  const v = workerVerdict()
  if (v === 'outdated' || v === 'unsafe') return v
  return null
}

/** A chain this device carries now (the engine acts on it, or it is being made). */
export const carried = (rec: OrderRecord | null): rec is OrderRecord & { chain: OrderChain } => !!rec?.chain && (rec.state === 'running' || rec.state === 'halted' || rec.state === 'creating' || rec.state === 'interrupted' || (rec.state === 'draft' && !!rec.draft?.over))

/** Was the request pressed in this tab (a planner run of it here, a press note) — then nobody asked from elsewhere. */
function planningHere(rowId: ID): boolean {
  // a planner run of it in this tab (running or ended), or a press made here that left a note
  return !!useOrderPlanner.getState().runs[rowId] || !!usePressNotes.getState().notes[rowId]
}

/** One task that carries a request's relation, as its project shows it (display fields — the person confirms them). */
export interface ChainCarrier {
  id: ID
  kind: PipelineKind
  project: ID
  /** its Schritt number (null: none or not a whole number) */
  n: number | null
  createdAt: number
}

/**
 * The live tasks of every pipeline project that carry `rowId` in their Prüfauftrag relation, in Schritt order (then by
 * creation) — `skip`: ids of a chain this device already holds (an older finished chain's steps).
 */
export function chainCarriers(rowId: ID, skip: ReadonlySet<ID> = new Set()): ChainCarrier[] {
  const s = ws()
  const out: ChainCarrier[] = []
  for (const kind of PIPELINE_KINDS) {
    for (const dbId of pipelineDbIdsOf(kind)) {
      const db = s.databases[dbId]
      if (!db) continue
      const props = codingProps(db)
      if (!props.order) continue
      for (const id of rowIdsOf(dbId)) {
        const p = s.pages[id]
        if (!p || p.trashed || skip.has(id)) continue
        const v = p.properties[props.order]
        if (!Array.isArray(v) || !v.includes(rowId)) continue
        const raw = props.step ? p.properties[props.step] : null
        const n = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 999 ? raw : null
        out.push({ id, kind, project: dbId, n, createdAt: p.createdAt })
      }
    }
  }
  return out.sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
}

/** The ids of every chain a record holds (its own and the one it replaced). */
export function heldIds(rec: OrderRecord | null): Set<ID> {
  const out = new Set<ID>()
  for (const c of [rec?.chain, rec?.chain?.replaced?.chain]) for (const s of c?.steps ?? []) out.add(s.id)
  return out
}

/** A short, stable key of a list of ids (FNV-1a, base 36). */
function idsKey(ids: readonly string[]): string {
  let h = 0x811c9dc5
  const text = ids.join(',')
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Readers of the cards (onOrderCardsChanged) — told again once a held-back request settled. */
const readers = new Set<() => void>()
let recheck: { at: number; timer: ReturnType<typeof setTimeout> } | null = null
function recheckAt(at: number): void {
  if (recheck && recheck.at <= at) return
  if (recheck) clearTimeout(recheck.timer)
  recheck = {
    at,
    timer: setTimeout(() => {
      recheck = null
      for (const fn of [...readers]) fn()
    }, Math.max(50, at - Date.now() + 50)),
  }
}

/** Every card that waits on the person on this device now (see the head of this file). */
export function orderCards(now = Date.now()): OrderCard[] {
  if (codingReadOnly()) return []
  const s = ws()
  const recs = useOrderRecords.getState().recs
  const sc = orderScope()
  const moves = useChainMoves.getState().moves
  const team = inTeam()
  const linked = workerOnline()
  const out: OrderCard[] = []
  for (const row of orderRowIds(s)) {
    const k = `${sc}|${row}`
    if (!(k in recs)) {
      // not read in this tab yet: read it (the store's change reads the lamp again)
      void loadOrderRecord(row)
      continue
    }
    const stored = recs[k]
    if (stored === 'unreadable') continue
    const rec = stored ?? null
    const status = orderStatusKey(row, s)
    const chain = rec?.chain
    if (rec?.state === 'draft' && rec.draft && rec.draft.plan.steps.length > 0 && status === 'ready') {
      out.push({ id: `order:${row}:ready@${rec.draft.hash.slice(0, 8)}`, kind: 'ready', row, at: rec.draft.at })
      continue
    }
    if (rec?.state === 'interrupted' && chain) {
      out.push({ id: `order:${row}:interrupted@${chain.run.slice(0, 8)}`, kind: 'interrupted', row, at: chain.confirmedAt })
      continue
    }
    if (rec?.state === 'halted' && chain?.halted && chain.halted.why !== 'finished') {
      out.push({ id: `order:${row}:halted@${chain.halted.at.toString(36)}`, kind: 'halted', row, at: chain.halted.at })
      continue
    }
    if (rec?.state === 'running' && chain && !chain.halted) {
      const m = moves[row]?.move
      if (m?.kind === 'card') {
        const at = (m.from !== null ? chain.doneBy[m.from]?.at : undefined) ?? moves[row]!.at
        out.push({ id: `order:${row}:next:${m.step}@${chain.run.slice(0, 8)}:${[...m.all].sort().join('+')}`, kind: 'next', row, at, step: m.step })
      }
      continue
    }
    if (status === 'running' && !carried(rec) && (!team || linked)) {
      const page = s.pages[row]
      if (!page) continue
      // another tab's chain arrives with its save: only a Status that stood a while counts (read again then)
      if (now - page.updatedAt < CONFIRM_SETTLE_MS) {
        recheckAt(page.updatedAt + CONFIRM_SETTLE_MS)
        continue
      }
      const carriers = chainCarriers(row, heldIds(rec))
      if (carriers.length) out.push({ id: `order:${row}:chainConfirm@${idsKey(carriers.map((c) => c.id))}`, kind: 'chainConfirm', row, at: page.updatedAt })
      continue
    }
    if (status === 'plan' && team && linked && !rec?.want && !(rec?.state === 'draft' && rec.draft) && !carried(rec) && !planningHere(row)) {
      out.push({ id: `order:${row}:request`, kind: 'request', row, at: s.pages[row]?.updatedAt ?? 0 })
    }
  }
  return out
}

/** Call `fn` when the cards may differ (records, the engine's moves, request / pipeline rows, the worker link, the account). */
export function onOrderCardsChanged(fn: () => void): () => void {
  const isOrdersOrPipeline = (id: ID): boolean => {
    const sys = (ws().databases[id] as Database | undefined)?.system
    return sys === 'workorders' || sys === 'coding' || sys === 'spec' || sys === 'qa'
  }
  const offs = [
    useOrderRecords.subscribe((s, p) => {
      if (s.recs !== p.recs) fn()
    }),
    useChainMoves.subscribe((s, p) => {
      if (s.moves !== p.moves) fn()
    }),
    onRowsChanged((c) => {
      if (c.reset || c.structure || [...c.dbs].some(isOrdersOrPipeline)) fn()
    }),
    useCoding.subscribe((s, p) => {
      if (s.enabled !== p.enabled || s.conn !== p.conn || s.can !== p.can || s.worker !== p.worker) fn()
    }),
    useCloud.subscribe((s, p) => {
      if (s.user?.id !== p.user?.id || s.readOnly !== p.readOnly) fn()
    }),
    useOrderPlanner.subscribe((s, p) => {
      if (s.runs !== p.runs) fn()
    }),
  ]
  readers.add(fn)
  return () => {
    readers.delete(fn)
    offs.forEach((off) => off())
  }
}

/** Call `fn` when something was seen in full on a plate or a card (the ready card's key may unblock). */
export const onOrderSeen = (fn: () => void): (() => void) => onSeen(fn)

/**
 * A coding card's chain mark: "PA-12 · 2/3" for a task that is a step of a chain on this device (its record — never
 * the Prüfauftrag / Schritt fields); null: none.
 */
export function chainChipOf(taskId: ID): string | null {
  const prefix = `${orderScope()}|`
  for (const [key, rec] of Object.entries(useOrderRecords.getState().recs)) {
    if (!key.startsWith(prefix) || !rec || rec === 'unreadable' || !rec.chain) continue
    if (rec.state === 'discarded' || (rec.state === 'draft' && !rec.draft?.over && !rec.draft?.from)) continue
    const steps = [...rec.chain.steps].sort((a, b) => a.n - b.n)
    const i = steps.findIndex((s) => s.id === taskId)
    if (i < 0) continue
    return t('features.coding.order.chip.step', { id: orderCode(key.slice(prefix.length)) ?? '—', n: i + 1, total: steps.length })
  }
  return null
}
