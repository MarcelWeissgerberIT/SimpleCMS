/**
 * Work orders — the trigger subscriber and the kept presses (spec §0, §1.3, §1.10, §2.3, §3.1; B4). Started once by
 * coding/service.ts startCoding().
 *
 * The subscriber reads, inside the store listener (synchronously — the writer frame of the write that woke it is still
 * open), every change of a request's Status by option id:
 *  - Only the PERSON in THIS tab counts: a writer `you` via none / 'ui' (a board drag, a cell pick; without a frame: a
 *    trusted event of the person). Never an Undo, a restore, a template, a form, an automation, a script, the sync, an
 *    import, an agent, the bridge, the terminal, a cross-tab replay or a colleague's change: those are ignored here (the
 *    chain engine reads a halt on its own).
 *  - Status → Planen = a press (press.ts). The provenance is captured from `prev` right here — before the attribution
 *    keeper's microtask can clear an agent's stamp. A row that is NEW in that write (a card added in the Planen lane)
 *    is no press: a half-written request is never planned.
 *  - The lane rules (§1.10), "put back" written by the order writer `#s` in this tab: into Planen while a chain runs →
 *    back ("Kette läuft — erst anhalten"); into Läuft / Kette bereit by hand → back, the toast names the key; into
 *    Fertig while running → asks ("Kette beenden?"; yes: halt + Fertig, no: back); into Entwurf from Kette bereit = D
 *    (the plan discarded, Z in the toast), while running → back; into Angehalten = H (the engine's, B7).
 *
 * The kept presses (wants): 5 s after an 'ok' worker is online in this tab, every live want of this device's scope
 * plans in mode 'trigger' — only while its row still stands in Planen; one that is 24 h old has expired (a fresh read
 * drops it, records.ts; the plate says "abgelaufen" only while this tab still holds it). Spent (compare-and-set) before
 * it plans, so a second tab or pass never plans it again; the planner only through press.ts `callPlanner`. One the
 * planner held (the Regler's line) or refused (its own check) is put back, and tried again only once the worker next
 * comes online here (`parked`).
 */
import { pageChanges, useWorkspace } from '../../../store/store'
import { isApplyingRemote } from '../../../store/persistence'
import type { Database, ID, OrderStatusKey } from '../../../store/types'
import { currentWriter, formatWriterKey, inPersonEvent, SYSTEM, withWriter, type Writer } from '../../../store/writer'
import { useUI } from '../../../store/ui'
import { isApplyingCloudChange } from '../../../cloud'
import { newId } from '../../../lib/ids'
import { t } from '../../../i18n'
import { useCoding, type CodingState } from '../state'
import { workerVerdict } from '../link'
import { withHalt } from '../chain'
import { addOrderRepoOptions, isOrderRow, orderCode, orderDbIds, orderProps, orderStatusKey, statusKeyOf, writeOrderStatus } from './db'
import { callPlanner, dropWant, orderPreNow, pressPlan, pressProv, setPressNote, statusWriter, wantLive, type PressResult } from './press'
import { loadOrderRecord, ORDERS_CHANNEL, patchOrderRecord } from './records'
import { scope } from '../local'
import { createStore, keys, type UseStore } from 'idb-keyval'
import { preWhyText, untilText } from './text'
import { ORDER_LIMITS, type OrderPress, type OrderRecord } from './types'

const ws = () => useWorkspace.getState()

/** A kept press plans this long after an 'ok' worker is online here (§3.1). */
export const WANT_DELAY_MS = 5000

/* ------------------------------------------------------------------ who wrote */

/**
 * The writer of the write happening now, as this tab sees it: the open frame; without one, a cross-tab replay or a
 * colleague's change is no one's here (null), a trusted event of the person is `you~ui`.
 */
function writerNow(): Writer | null {
  const w = currentWriter()
  if (w) return w
  if (isApplyingRemote() || isApplyingCloudChange()) return null
  return inPersonEvent() ? { kind: 'you', via: 'ui' } : null
}

/** The allow-list of a Status write: the person, in this tab, by hand (via none / 'ui'). */
export const isPersonStatusWrite = (w: Writer | null): boolean => !!w && w.kind === 'you' && (!w.via || w.via === 'ui')

/* ------------------------------------------------------------------ the subscriber */

/** The work-orders databases of a databases map (cached per map: the subscriber runs on every write). */
let dbCache: { of: Record<ID, Database>; ids: Set<ID> } | null = null
function ordersDbs(databases: Record<ID, Database>): Set<ID> {
  if (dbCache?.of === databases) return dbCache.ids
  const ids = new Set<ID>()
  for (const db of Object.values(databases)) if (db.system === 'workorders') ids.add(db.id)
  dbCache = { of: databases, ids }
  return ids
}

const toast = (message: string, kind: 'info' | 'error' = 'info'): void => void useUI.getState().toast({ message, kind })
const label = (rowId: ID) => orderCode(rowId) ?? (ws().pages[rowId]?.title.trim() || t('common.untitled'))

/** Put a request's Status back where it was — the order writer `#s` (its chain's run, else a fresh one). */
async function putBack(rowId: ID, to: OrderStatusKey): Promise<void> {
  const rec = asRecord(await loadOrderRecord(rowId))
  const run = rec?.chain?.run ?? rec?.draft?.run ?? newId()
  writeOrderStatus(rowId, to, statusWriter(rowId, run))
}

/** What a press made of a Status → Planen by hand: said in a toast (the plate is not in view on the board). */
function sayPress(rowId: ID, r: PressResult): void {
  if (r.kind === 'planning') return
  if (r.kind === 'kept') return toast(t('features.coding.order.toast.kept', { id: label(rowId), why: preWhyText(r.why), time: untilText(Date.now() + ORDER_LIMITS.wantMs) }))
  if (r.why === 'gone') return
  toast(t('features.coding.order.toast.refused', { id: label(rowId), why: preWhyText(r.why, r.left) }), 'error')
}

/** The person moved a request from `prev` to `next` (§1.10). `captured`: the provenance before the write. */
function onPersonMove(rowId: ID, prev: OrderStatusKey | null, next: OrderStatusKey, captured: ReturnType<typeof pressProv>): void {
  switch (next) {
    case 'plan':
      if (prev === 'running') {
        void putBack(rowId, 'running')
        return toast(t('features.coding.order.toast.running', { id: label(rowId) }))
      }
      void pressPlan(rowId, 'status', { captured }).then((r) => sayPress(rowId, r))
      return
    case 'running':
    case 'ready':
      // only the planner sets Kette bereit, only ↵ Kette starten / ↵ Fortsetzen set Läuft
      if (prev) void putBack(rowId, prev)
      return toast(t(next === 'ready' ? 'features.coding.order.toast.readyByHand' : prev === 'halted' ? 'features.coding.order.toast.resumeKey' : prev === 'ready' ? 'features.coding.order.toast.startKey' : 'features.coding.order.toast.planFirst', { id: label(rowId) }))
    case 'done':
      if (prev === 'running') askFinish(rowId)
      return
    case 'draft':
      if (prev === 'running') {
        void putBack(rowId, 'running')
        return toast(t('features.coding.order.toast.running', { id: label(rowId) }))
      }
      if (prev === 'ready') void discardDraft(rowId)
      return
    default:
      // into Angehalten: the halt (H) — the chain engine reads it from the Status, whoever wrote it
      return
  }
}

/** Into Fertig while a chain runs: "Kette beenden? Der laufende Schritt läuft fertig" — yes: halt + Fertig; no: back. */
function askFinish(rowId: ID): void {
  useUI.getState().openModal({
    type: 'confirm',
    title: t('features.coding.order.finish.title', { id: label(rowId) }),
    body: t('features.coding.order.finish.body'),
    confirmLabel: t('features.coding.order.finish.yes'),
    onConfirm: () =>
      void patchOrderRecord(rowId, (rec) => (rec?.chain ? { ...rec, state: 'halted', chain: withHalt(rec.chain, { why: 'status', by: 'you~ui' }, Date.now()) } : rec)),
    onCancel: () => void putBack(rowId, 'running'),
  })
}

/** Kette bereit → Entwurf by hand = D: the plan is discarded on this device (Z in the toast brings both back). */
async function discardDraft(rowId: ID): Promise<void> {
  const before = asRecord(await loadOrderRecord(rowId, { fresh: true }))
  if (before?.state === 'draft' && before.draft) await patchOrderRecord(rowId, (rec) => (rec?.state === 'draft' && rec.draft ? { ...rec, state: 'discarded' } : rec))
  useUI.getState().toast({
    message: t('features.coding.order.toast.discarded', { id: label(rowId) }),
    action: {
      label: t('common.undo'),
      undo: true,
      run: () => {
        void (async () => {
          await patchOrderRecord(rowId, (rec) => (rec?.state === 'discarded' && rec.draft ? { ...rec, state: 'draft' } : rec))
          writeOrderStatus(rowId, 'ready', { kind: 'you', via: 'undo' })
        })()
      },
    },
  })
}

/** The row's Status field is empty (no option at all — not one of another build's). */
function noStatus(db: Database, row: { properties: Record<ID, unknown> }): boolean {
  const prop = orderProps(db).status
  return !!prop && (row.properties[prop] === undefined || row.properties[prop] === null || row.properties[prop] === '')
}

/** A new request without a Status: Entwurf (bookkeeping — nobody's change; never over a Status set meanwhile). */
function draftIfNone(rowId: ID): void {
  const s = ws()
  const row = s.pages[rowId]
  const db = row?.databaseId ? s.databases[row.databaseId] : undefined
  if (!row || !db || row.trashed || !noStatus(db, row)) return
  writeOrderStatus(rowId, 'draft', SYSTEM('bookkeeping'))
}

function onPages(state: ReturnType<typeof ws>, prev: ReturnType<typeof ws>): void {
  if (state.pages === prev.pages || !state.ready || !prev.ready || state.epoch !== prev.epoch) return
  const dbs = ordersDbs(state.databases)
  if (!dbs.size) return
  let who: Writer | null | undefined
  for (const id of pageChanges(state.pages, prev.pages).changed) {
    const now = state.pages[id]
    const before = prev.pages[id]
    if (!now?.databaseId || !dbs.has(now.databaseId)) continue
    // a new row is no press (a card added in the Planen lane is a half-written request); one made here without a Status
    // (a table's "New", the sidebar's + entry) stands in Entwurf — the board hides rows without one
    if (!before) {
      if (who === undefined) who = writerNow()
      if (who && !now.trashed && noStatus(state.databases[now.databaseId]!, now)) queueMicrotask(() => draftIfNone(id))
      continue
    }
    if (now.properties === before.properties) continue
    const db = state.databases[now.databaseId]
    if (!db) continue
    const next = statusKeyOf(db, now)
    const was = statusKeyOf(db, before)
    if (!next || next === was) continue
    if (who === undefined) who = writerNow()
    if (!isPersonStatusWrite(who)) continue
    if (now.trashed || !isOrderRow(id, state)) continue
    // the provenance BEFORE this write (the keeper may clear an agent's stamp in a microtask after it)
    const captured = pressProv(prev.pages, id)
    // after every listener saw this write (a put-back is a write of its own)
    queueMicrotask(() => onPersonMove(id, was, next, captured))
  }
}

/* ------------------------------------------------------------------ kept presses */

/** A record this build can act on (a later build's — 'unreadable' — is no record here). */
const asRecord = (r: OrderRecord | null | 'unreadable' | undefined): OrderRecord | null => (r && r !== 'unreadable' ? r : null)

let idb: UseStore | null = null
/** The rows of this scope with a record on this device (IndexedDB keys `<scope>|order|<row>`). */
async function recordRows(): Promise<ID[]> {
  if (typeof indexedDB === 'undefined') return []
  const prefix = `${scope()}|order|`
  try {
    return (await keys((idb ??= createStore('one-coding', 'kv')))).map(String).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
  } catch {
    return []
  }
}

/** The worker link's verdict (coding/link.ts — the one the preconditions read). */
const verdictOf = (s: CodingState): 'ok' | 'outdated' | 'unsafe' | null => workerVerdict(s)

let wantTimer: ReturnType<typeof setTimeout> | null = null
let firing: Promise<void> | null = null
/**
 * Kept presses this tab put back after the planner held them (the Regler's line) or refused them (its own check): row →
 * the want's time. Not fired again until the worker next comes online here — putting a want back writes the record,
 * whose channel message would otherwise start the next pass, and that one the next (a loop every 5 s).
 */
const parked = new Map<ID, number>()

function scheduleWants(delay = WANT_DELAY_MS): void {
  if (wantTimer) clearTimeout(wantTimer)
  wantTimer = setTimeout(() => {
    wantTimer = null
    void fireWants()
  }, delay)
}

/** Plan every live kept press of this scope now (only while an 'ok' worker is online in this tab). */
export function fireWants(): Promise<void> {
  if (firing) return firing
  firing = (async () => {
    if (verdictOf(useCoding.getState()) !== 'ok') return
    for (const rowId of await recordRows()) {
      const rec = asRecord(await loadOrderRecord(rowId, { fresh: true }))
      if (!rec?.want || !wantLive(rec.want)) continue
      const at = rec.want.at
      if (parked.get(rowId) === at) continue
      // the request left Planen (or is gone) since: its press is spent
      if (!isOrderRow(rowId) || orderStatusKey(rowId) !== 'plan') {
        await patchOrderRecord(rowId, (r) => (r?.want ? dropWant(r) : r))
        continue
      }
      const pre = orderPreNow(rowId)
      if (!pre.ok) {
        setPressNote(rowId, { why: pre.why, at: Date.now(), left: pre.left })
        continue
      }
      const press: OrderPress = rec.want.press ?? { run: newId(), at, how: 'status', ...pressProv(ws().pages, rowId) }
      // spent before it plans: a second tab (or a second pass) never plans it again
      let mine = false
      await patchOrderRecord(rowId, (r) => {
        if (!r?.want || r.want.at !== at) return r
        mine = true
        return dropWant(r)
      })
      if (!mine) continue
      setPressNote(rowId, { why: 'planning', at: Date.now(), left: pre.left })
      const kept = rec.want
      // the Regler held it, or the planner's own check refused it: the press stays kept (B5 — "the want stays")
      void callPlanner(rowId, 'trigger', press).then((kind) => {
        if (kind !== 'held' && kind !== 'blocked') return
        parked.set(rowId, kept.at)
        void patchOrderRecord(rowId, (r) => (!r ? { v: 1, state: 'draft', want: kept } : !r.want && r.state === 'draft' ? { ...r, want: kept } : r))
      })
    }
  })().finally(() => {
    firing = null
  })
  return firing
}

/* ------------------------------------------------------------------ start */

let started = false

/** The trigger subscriber, the kept presses and the Repo options (once, from startCoding). */
export function startOrders(): void {
  if (started || typeof window === 'undefined') return
  started = true
  useWorkspace.subscribe(onPages)
  useCoding.subscribe((s, prev) => {
    const v = verdictOf(s)
    if (v === 'ok' && verdictOf(prev) !== 'ok') {
      // the worker is back: what the planner held or refused before may plan now
      parked.clear()
      scheduleWants()
    }
    if (v !== 'ok' && wantTimer) {
      clearTimeout(wantTimer)
      wantTimer = null
    }
    // the worker's repos as the requests' Repo options: upkeep, nobody's change (as the pipelines')
    if (s.worker !== prev.worker && s.worker?.repos.length) {
      const names = s.worker.repos.map((r) => r.name)
      withWriter(SYSTEM('maintenance'), () => {
        for (const id of orderDbIds()) addOrderRepoOptions(id, names)
      })
    }
  })
  // a press kept in another tab of this device while this one holds the worker (the records' channel)
  try {
    const ch = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ORDERS_CHANNEL)
    ch?.addEventListener('message', () => {
      if (verdictOf(useCoding.getState()) === 'ok' && !wantTimer) scheduleWants()
    })
  } catch {
    /* no channel: this tab's own presses only */
  }
  if (verdictOf(useCoding.getState()) === 'ok') scheduleWants()
  if (seamOn()) installSeam()
}

/* ------------------------------------------------------------------ e2e seam */

function seamOn(): boolean {
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
}

function installSeam(): void {
  void import('./entrySeam').then((m) => m.installOrderEntriesSeam({ fireWants, writerKey: formatWriterKey }))
}
