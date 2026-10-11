/**
 * Running the queue's keys (§7.5) — the only caller of the sources' card actions. Every key is recomputed when it is
 * pressed (its VON HAND reasons, whether it is blocked); a VON HAND key first opens the card's confirm row and runs only
 * from the confirm key; ONE call into the source happens before any await (a sign-in window stays inside the press).
 * What happened is what the source says (an action that changed nothing is not done): the card leaves, the lamp clicks
 * down in the same frame (the overlay) and is read again at once, the Bordbuch notes it. Z undoes the newest entry
 * (a batch together) and never skips to an older one. ⇧A takes only clean cards that were shown in full in this tab —
 * the bulk sheet shows the rest first — and never on "All".
 */
import { nanoid } from 'nanoid'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { focusIsNowhere, mainRegion, restoreFocus } from '../../../ui/focus'
import { lampSource, lampSources, type CardAction, type Done, type HandWhy, type LampId, type QueueItem } from '../registry'
import { flush, markDirty } from '../engine'
import { appendLog, markOpened, wasOpened } from '../log'
import { isLit } from '../lamps'
import { usePreflight } from '../state'
import { reducedMotion } from '../touch'
import type { DoneEntry } from '../types'
import { bulkPlan, focusAfterLeave, mergeOrder, sortItems, staleOf, step, undoTarget } from './model'
import { useQueue, type QueueTab } from './state'

const Q = () => useQueue.getState()
/** a card's exit (ms; 0 under reduced motion) */
const EXIT_MS = 120
/** the optimistic overlay holds this long at most (the next reading normally agrees sooner) */
const OVERLAY_MS = 5000

/** A message key or text → text in the UI language. */
export const say = (x: string, vars?: Record<string, string | number>): string => (/^features\.|^common\./.test(x) ? t(x, vars) : x)

let flip = false
/** The live region (polite) reads this. */
export function announce(text: string): void {
  flip = !flip
  // the same text twice is read twice: a zero-width space tells them apart
  useQueue.setState({ live: flip ? text : `${text}​` })
}

/* ---------------- items, tabs, order */

const lampOrder = (lamp: LampId) => lampSource(lamp)?.order ?? 999
const opened = (id: string) => wasOpened(id) === true

/** The lamps with a queue that are lit now, in lamp order (the tabs). */
export function queueLamps(): LampId[] {
  return usePreflight
    .getState()
    .views.filter((v) => v.hasQueue && isLit(v.level))
    .map((v) => v.id)
}

/** The tab shown: the one opened in this tab, else the first new lamp's, else the first lit one's. */
export function shownTab(lamp: QueueTab | null = Q().lamp): QueueTab | null {
  const lamps = queueLamps()
  if (lamp === 'all' && lamps.length) return 'all'
  if (lamp && lamps.includes(lamp)) return lamp
  const views = usePreflight.getState().views
  return views.find((v) => v.isNew && lamps.includes(v.id))?.id ?? lamps[0] ?? null
}

/** The live items of a tab in risk order (with `stale` set). */
export function tabItems(tab: QueueTab, items = Q().items): QueueItem[] {
  const lamps = tab === 'all' ? queueLamps() : [tab]
  const list = lamps.flatMap((l) => items[l] ?? [])
  return sortItems(list, lampOrder, Date.now(), opened)
}

/** The item of an id (live, else the copy kept for a tombstone). */
export function itemOf(id: string): QueueItem | null {
  const s = Q()
  for (const list of Object.values(s.items)) {
    const it = list?.find((x) => x.id === id)
    if (it) return { ...it, stale: staleOf(it, Date.now(), opened) }
  }
  return s.seen[id] ?? null
}

const doneIds = (done: readonly DoneEntry[]) => new Set(done.filter((e) => !e.undone).map((e) => e.id))

/** Open = listed by its source now, not done in this tab, not leaving, not a tombstone. */
export function openTest(s = Q()): (id: string) => boolean {
  const live = new Set(Object.values(s.items).flatMap((l) => (l ?? []).map((i) => i.id)))
  const done = doneIds(s.done)
  return (id) => live.has(id) && !done.has(id) && !s.leaving[id] && !s.tombstones[id]
}

/** Bring a tab's order up to date with its items (arrivals at their risk place) and make sure it has a current card. */
export function syncTab(tab: QueueTab): void {
  const s = Q()
  const sorted = tabItems(tab, s.items).map((i) => i.id)
  const order = mergeOrder(s.order[tab], sorted)
  const isOpen = openTest(s)
  let card = s.card[tab]
  if (!card || !order.includes(card) || (!isOpen(card) && !s.tombstones[card] && !s.leaving[card])) card = order.find(isOpen) ?? undefined
  const same = order.length === (s.order[tab]?.length ?? -1) && order.every((id, i) => id === s.order[tab]![i])
  if (same && card === s.card[tab]) return
  useQueue.setState((q) => ({ order: same ? q.order : { ...q.order, [tab]: order }, card: { ...q.card, [tab]: card } }))
}

/* ---------------- loading a lamp's cards */

const loads = new Map<LampId, Promise<void>>()
const gens = new Map<LampId, number>()

/** Read a lamp's cards (its source's `load()` once, then `items()`), and settle what left the reading. */
export async function loadItems(lamp: LampId): Promise<void> {
  const src = lampSource(lamp)?.queue
  if (!src) return
  const g = (gens.get(lamp) ?? 0) + 1
  gens.set(lamp, g)
  try {
    if (src.load) {
      let p = loads.get(lamp)
      if (!p) {
        p = src.load().catch((e) => console.warn(`[one] preflight: the cards of ${lamp} could not load`, e))
        loads.set(lamp, p)
      }
      await p
    }
    const out = await src.items({ now: Date.now(), signal: new AbortController().signal })
    if (gens.get(lamp) !== g) return
    settleReading(lamp, out)
  } catch (e) {
    console.warn(`[one] preflight: the cards of ${lamp} could not be listed`, e)
  }
}

/** Forget what the sources loaded (a scope change). */
export function forgetLoads(): void {
  loads.clear()
  gens.clear()
}

/**
 * A lamp's new list: cards in work whose id left are done (with the outcome the source maps); a current card that went
 * without the person's key becomes a tombstone ("done elsewhere") until they move on; the overlay entries the reading
 * now agrees with go.
 */
function settleReading(lamp: LampId, out: QueueItem[]): void {
  const ids = new Set(out.map((i) => i.id))
  const s = Q()
  const prev = s.items[lamp] ?? []
  const done = doneIds(s.done)
  const now = Date.now()
  const src = lampSource(lamp)?.queue
  const finished: DoneEntry[] = []
  const inWork = { ...s.inWork }
  for (const [id, e] of Object.entries(s.inWork)) {
    if (e.lamp !== lamp || ids.has(id)) continue
    delete inWork[id]
    let outcome = e.outcome
    try {
      outcome = src?.resolved?.(id) ?? e.outcome
    } catch {
      /* the key's own */
    }
    finished.push({ ...e, outcome, at: now })
  }
  const tombstones = { ...s.tombstones }
  const seen = { ...s.seen }
  for (const cur of Object.values(s.card)) {
    if (!cur || ids.has(cur) || done.has(cur) || inWork[cur] || finished.some((f) => f.id === cur) || s.leaving[cur]) continue
    const was = prev.find((p) => p.id === cur)
    if (!was) continue
    tombstones[cur] = 'elsewhere'
    seen[cur] = was
  }
  const keep = (list: QueueState['pending'], present: boolean) => list.filter((p) => p.lamp !== lamp || (ids.has(p.id) === present && now - p.at < OVERLAY_MS))
  useQueue.setState({
    items: { ...s.items, [lamp]: out },
    inWork,
    tombstones,
    seen,
    done: [...s.done, ...finished],
    // pending: kept while the reading still has the id; undone: while it does not have it yet
    pending: keep(s.pending, true),
    undone: keep(s.undone, false),
  })
  for (const e of finished) {
    appendLog({ at: e.at, k: 'card', lamp: e.lamp, item: e.id, outcome: e.outcome, kind: e.label.kind, refs: e.label.refs })
    leave(e.id, e.outcome === 'discarded' ? 'left' : 'right')
  }
  for (const tab of Object.keys(Q().order)) syncTab(tab)
}

type QueueState = ReturnType<typeof Q>

/* ---------------- running a key */

/** The card's keys now (recomputed: VON HAND reasons, blocked). */
export function actionsOf(item: QueueItem | null): CardAction[] {
  if (!item) return []
  try {
    return lampSource(item.lamp)?.queue?.actions(item) ?? []
  } catch (e) {
    console.warn('[one] preflight: a card’s keys could not be read', e)
    return []
  }
}

/** The tab a card belongs to now (for focus after it leaves). */
const tabNow = (): QueueTab | null => shownTab()

/** Focus the current card's frame after the next render (never the body). */
export function focusCard(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('.pf-q article.pf-card[data-current]')
      if (el) return restoreFocus(el)
      // the lamp's queue is empty: the next lit lamp's tab, else MASTER CAUTION on the strip, else the main region
      const tab = document.querySelector<HTMLElement>('.pf-q [role="tab"][aria-selected="true"]')
      if (tab) return restoreFocus(tab)
      const mc = document.querySelector<HTMLElement>('[data-testid="pf-mkey-strip"], [data-testid="pf-mkey"]')
      if (mc) return restoreFocus(mc)
      if (focusIsNowhere()) restoreFocus(mainRegion())
    }),
  )
}

/** Move focus onto a card's frame now (before an action runs — the key that held it may be disabled or go). */
function focusFrame(id: string): void {
  const el = document.querySelector<HTMLElement>(`.pf-q article.pf-card[data-id="${CSS.escape(id)}"]`)
  if (el && document.activeElement !== el) restoreFocus(el)
}

/** A card leaves (120 ms of motion, 0 under reduced motion); the current card moves on and takes focus. */
function leave(id: string, dir: 'right' | 'left'): void {
  useQueue.setState((s) => ({ leaving: { ...s.leaving, [id]: dir } }))
  const done = () => {
    const s = Q()
    const leaving = { ...s.leaving }
    delete leaving[id]
    const isOpen = openTest({ ...s, leaving })
    const card = { ...s.card }
    for (const [tab, cur] of Object.entries(s.card)) {
      if (cur !== id) continue
      card[tab] = focusAfterLeave(s.order[tab] ?? [], id, isOpen) ?? undefined
    }
    const wasCurrent = Object.values(s.card).includes(id)
    useQueue.setState({ leaving, card })
    if (wasCurrent) {
      const tab = tabNow()
      if (tab && !card[tab]) {
        // the lamp's queue is empty: the next lit lamp's tab
        const next = queueLamps().find((l) => l !== tab && (Q().items[l] ?? []).some((i) => isOpen(i.id)))
        if (next) useQueue.setState({ lamp: next })
      }
      focusCard()
    }
  }
  if (reducedMotion()) done()
  else setTimeout(done, EXIT_MS)
}

/** The VON HAND confirm row on a card (the reasons computed now). */
function openConfirm(item: QueueItem, key: string, why: HandWhy[], input?: string): void {
  useQueue.setState({ confirm: { id: item.id, key, why, ...(input !== undefined ? { input } : {}) } })
  announce(`${t('features.preflight.risk.hand')}: ${why.map((w) => t(`features.preflight.risk.why.${w}`)).join(' · ')}`)
}

/**
 * Press a card's key. `input`: the text of its field (an answer, a rework note). `armed`: from the confirm key of the
 * VON HAND row. Calls the source ONCE, before any await.
 */
export function runAction(item: QueueItem, key: string, input?: string, armed = false): void {
  const s = Q()
  if (s.busy) return
  // a tombstone has no keys; a card in work only O and D
  if (s.tombstones[item.id] || (s.inWork[item.id] && key !== 'o' && key !== 'd')) return
  const action = actionsOf(item).find((a) => a.key === key)
  if (!action) return
  if (action.blocked) {
    announce(say(action.blocked.key, action.blocked.vars))
    return
  }
  const cloud = useCloud.getState()
  if (action.writes && (cloud.readOnly || cloud.outdated)) {
    announce(t('features.preflight.why.readOnly'))
    return
  }
  if (action.input && input === undefined) {
    useQueue.setState({ input: { id: item.id, key }, confirm: null })
    return
  }
  if (action.hand?.length && !(armed && s.confirm?.id === item.id && s.confirm.key === key)) {
    openConfirm(item, key, action.hand, input)
    return
  }
  focusFrame(item.id)
  markOpened(item.id)
  const now = Date.now()
  useQueue.setState((q) => {
    const error = { ...q.error }
    delete error[item.id]
    return { busy: item.id, confirm: null, input: null, error, pending: [...q.pending, { lamp: item.lamp, id: item.id, at: now }] }
  })
  let p: Promise<Done> | Done
  try {
    p = action.run(item, input)
  } catch (e) {
    p = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  void settle(item, action, p)
}

async function settle(item: QueueItem, action: CardAction, p: Promise<Done> | Done): Promise<void> {
  let res: Done
  try {
    res = await p
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const unpend = (q: QueueState) => q.pending.filter((x) => x.id !== item.id)
  if (!res.ok) {
    const fail = res
    useQueue.setState((q) => ({
      busy: null,
      pending: unpend(q),
      ...(fail.elsewhere ? { tombstones: { ...q.tombstones, [item.id]: 'elsewhere' as const }, seen: { ...q.seen, [item.id]: item } } : { error: { ...q.error, [item.id]: fail.error } }),
    }))
    announce(fail.elsewhere ? t('features.preflight.card.elsewhere') : say(fail.error))
    focusCard()
    return
  }
  if (res.stay) {
    useQueue.setState((q) => ({ busy: null, pending: unpend(q) }))
    return
  }
  const entry: DoneEntry = {
    id: item.id,
    lamp: item.lamp,
    outcome: res.outcome ?? action.outcome,
    at: Date.now(),
    ...(res.undo ? { undo: res.undo } : {}),
    ...(res.final ? { final: res.final } : {}),
    ...(res.note ? { note: res.note } : {}),
    label: { kind: item.kind, refs: item.refs },
  }
  if (item.resolveBy === 'reading' || res.resolve === 'reading') {
    // the source decides by its reading (a slip sent, a sign-in done): "in work" until its id leaves
    useQueue.setState((q) => ({ busy: null, pending: unpend(q), inWork: { ...q.inWork, [item.id]: entry } }))
    announce(t('features.preflight.card.inWork'))
    void readNow(item.lamp)
    return
  }
  useQueue.setState((q) => ({ busy: null, done: [...q.done, entry] }))
  appendLog({ at: entry.at, k: 'card', lamp: entry.lamp, item: entry.id, outcome: entry.outcome, kind: item.kind, refs: item.refs })
  leave(item.id, entry.outcome === 'discarded' ? 'left' : 'right')
  announceDone([entry])
  void readNow(item.lamp)
}

/** The lamp clicks down at once: read now (settle 0) and its cards again. */
async function readNow(lamp: LampId): Promise<void> {
  markDirty(lamp, 0)
  await flush(lamp)
  await loadItems(lamp)
}

/** "#NL-201 applied · 8 left" (labels live; the kind word when none). */
function announceDone(entries: DoneEntry[]): void {
  const tab = tabNow()
  const left = tab ? tabItems(tab).filter((i) => openTest()(i.id)).length : 0
  const first = entries[0]
  const it = itemOf(first.id)
  const label = it?.keyText ? `#${it.keyText}` : it?.title || t(`features.preflight.kind.${first.label.kind}`)
  const what = entries.length > 1 ? t('features.preflight.queue.batch', { n: entries.length }) : `${label} ${t(`features.preflight.queue.outcome.${first.outcome}`)}`
  announce(`${what} · ${t('features.preflight.queue.left', { n: left })}`)
}

/** The confirm key of the VON HAND row (↵ / Space / click on it — never a second A). Reasons new since → the row again. */
export function confirmHand(): void {
  const c = Q().confirm
  if (!c) return
  const item = itemOf(c.id)
  const action = actionsOf(item).find((a) => a.key === c.key)
  if (!item || !action) {
    useQueue.setState({ confirm: null })
    return
  }
  const now = action.hand ?? []
  if (now.some((w) => !c.why.includes(w))) {
    openConfirm(item, c.key, now, c.input)
    return
  }
  runAction(item, c.key, c.input, true)
}

export function cancelConfirm(): void {
  if (!Q().confirm) return
  useQueue.setState({ confirm: null })
  focusCard()
}

/* ---------------- moving */

/** Make a card current (a row clicked, J / K). It is opened; viewed once its body is shown. */
export function setCurrent(tab: QueueTab, id: string | null): void {
  useQueue.setState((s) => {
    const tombstones = { ...s.tombstones }
    // moving on clears a tombstone
    const cur = s.card[tab]
    if (cur && cur !== id && tombstones[cur]) delete tombstones[cur]
    return { card: { ...s.card, [tab]: id ?? undefined }, confirm: null, input: null, bulk: null, tombstones }
  })
  if (id) markOpened(id)
}

/** J / ↓ (1) · K / ↑ (−1). */
export function move(dir: 1 | -1): void {
  const tab = tabNow()
  if (!tab) return
  syncTab(tab)
  const s = Q()
  const next = step(s.order[tab] ?? [], s.card[tab] ?? null, dir, openTest(s))
  if (!next) {
    announce(t(dir > 0 ? 'features.preflight.queue.last' : 'features.preflight.queue.first'))
    return
  }
  setCurrent(tab, next)
  focusCard()
}

/* ---------------- ⇧A, X */

/** ⇧A: apply the clean cards of the tab that were shown in full; unseen ones go to the bulk sheet first. */
export function bulkApply(tab: QueueTab | null = tabNow(), confirmed = false): void {
  if (!tab) return
  if (tab === 'all') {
    announce(t('features.preflight.queue.bulkAllTab'))
    return
  }
  const s = Q()
  if (s.busy) return
  const isOpen = openTest(s)
  const items = tabItems(tab).filter((i) => isOpen(i.id) && !s.inWork[i.id])
  const plan = bulkPlan(
    items,
    (id) => !!s.viewed[id],
    (it) => {
      const a = actionsOf(it).find((k) => k.key === 'a')
      return a ? { hand: a.hand ?? [], blocked: !!a.blocked } : null
    },
  )
  if (!plan.clean.length) {
    announce(t('features.preflight.queue.noClean'))
    return
  }
  if (plan.unseen.length && !confirmed) {
    useQueue.setState({ bulk: { tab, ids: plan.unseen }, confirm: null, input: null })
    announce(t('features.preflight.queue.bulkSheet', { n: plan.unseen.length }))
    return
  }
  const cloud = useCloud.getState()
  if (cloud.readOnly || cloud.outdated) {
    announce(t('features.preflight.why.readOnly'))
    return
  }
  void runBatch(tab, plan.clean.map((id) => itemOf(id)!).filter(Boolean), 'a')
}

/** The bulk sheet's key: the unseen cards were shown in full there — now ⇧A applies. */
export function confirmBulk(): void {
  const b = Q().bulk
  if (!b) return
  useQueue.setState((s) => ({ viewed: { ...s.viewed, ...Object.fromEntries(b.ids.map((id) => [id, true as const])) }, bulk: null }))
  bulkApply(b.tab, true)
}

export function closeBulk(): void {
  if (!Q().bulk) return
  useQueue.setState({ bulk: null })
  focusCard()
}

/** X: discard every stale card of the tab whose discard has an Undo (the others stay: "discard one by one"). */
export function bulkDiscardStale(tab: QueueTab | null = tabNow()): void {
  if (!tab || Q().busy) return
  const isOpen = openTest()
  const stale = tabItems(tab).filter((i) => i.stale && isOpen(i.id))
  const take = stale.filter((i) => actionsOf(i).some((a) => a.key === 'd' && a.undoable && !a.blocked))
  if (!take.length) {
    announce(t(stale.length ? 'features.preflight.stale.oneByOne' : 'features.preflight.stale.none'))
    return
  }
  void runBatch(tab, take, 'd')
}

/** One batch over several cards: one source call per lamp (its `bulk`), else one by one in order. One Z takes it back. */
async function runBatch(tab: QueueTab, items: QueueItem[], key: 'a' | 'd'): Promise<void> {
  const batch = nanoid(8)
  const now = Date.now()
  focusCard()
  useQueue.setState((q) => ({ busy: `batch:${batch}`, confirm: null, pending: [...q.pending, ...items.map((i) => ({ lamp: i.lamp, id: i.id, at: now }))] }))
  const entries: DoneEntry[] = []
  const failed: string[] = []
  const byLamp = new Map<LampId, QueueItem[]>()
  for (const it of items) byLamp.set(it.lamp, [...(byLamp.get(it.lamp) ?? []), it])
  for (const [lamp, list] of byLamp) {
    const src = lampSource(lamp)?.queue
    const bulk = key === 'a' ? src?.bulk?.apply : src?.bulk?.discard
    const add = (it: QueueItem, res: Extract<Done, { ok: true }>, outcome: DoneEntry['outcome']) =>
      entries.push({ id: it.id, lamp, outcome: res.outcome ?? outcome, at: Date.now(), batch, ...(res.undo ? { undo: res.undo } : {}), ...(res.final ? { final: res.final } : {}), label: { kind: it.kind, refs: it.refs } })
    if (bulk) {
      try {
        const res = await bulk(list)
        if (res.ok) {
          const did = new Set(res.items ?? list.map((i) => i.id))
          for (const it of list) (did.has(it.id) ? add(it, res, key === 'a' ? 'applied' : 'discarded') : failed.push(it.id))
        } else failed.push(...list.map((i) => i.id))
      } catch (e) {
        console.warn('[one] preflight: a bulk action failed', e)
        failed.push(...list.map((i) => i.id))
      }
      continue
    }
    for (const it of list) {
      const action = actionsOf(it).find((a) => a.key === key)
      if (!action || action.blocked || action.hand?.length) continue
      try {
        const res = await action.run(it)
        if (res.ok && !res.stay) add(it, res, action.outcome)
        else failed.push(it.id)
      } catch {
        failed.push(it.id)
      }
    }
  }
  const did = new Set(entries.map((e) => e.id))
  useQueue.setState((q) => ({ busy: null, done: [...q.done, ...entries], pending: q.pending.filter((p) => did.has(p.id) || !items.some((i) => i.id === p.id)) }))
  for (const e of entries) {
    appendLog({ at: e.at, k: 'card', lamp: e.lamp, item: e.id, outcome: e.outcome, kind: e.label.kind, refs: e.label.refs, batch })
    leave(e.id, key === 'a' ? 'right' : 'left')
  }
  if (entries.length) announceDone(entries)
  if (failed.length) announce(t('features.preflight.queue.batchFailed', { n: failed.length }))
  for (const lamp of byLamp.keys()) void readNow(lamp)
  void tab
}

/* ---------------- Z */

/** Undo the newest done entry (a batch together). One without Undo says why and stops — never an older one. */
export async function undoLast(): Promise<void> {
  const s = Q()
  if (s.busy) return
  const entries = undoTarget(s.done)
  if (!entries.length) {
    announce(t('features.preflight.queue.nothingToUndo'))
    return
  }
  const fns = [...new Set(entries.map((e) => e.undo).filter((f): f is NonNullable<DoneEntry['undo']> => !!f))]
  if (!fns.length) {
    announce(t('features.preflight.queue.notUndoable', { why: t(entries[0].final ?? 'features.preflight.card.final.none') }))
    return
  }
  useQueue.setState({ busy: 'undo' })
  const out: Array<'undone' | 'kept' | 'final'> = []
  for (const fn of fns) {
    try {
      out.push(await fn())
    } catch (e) {
      console.warn('[one] preflight: an Undo failed', e)
      out.push('final')
    }
  }
  const taken = new Set(entries)
  const back = out.some((r) => r === 'undone' || r === 'kept')
  const now = Date.now()
  useQueue.setState((q) => ({
    busy: null,
    done: q.done.map((e) => (back && taken.has(e) ? { ...e, undone: true } : e)),
    undone: back ? [...q.undone, ...entries.map((e) => ({ lamp: e.lamp, id: e.id, at: now }))] : q.undone,
  }))
  if (!back) {
    announce(t('features.preflight.queue.final'))
    return
  }
  for (const e of entries) appendLog({ at: now, k: 'undo', item: e.id, lamp: e.lamp, ...(e.batch ? { batch: e.batch } : {}) })
  announce(out.includes('kept') ? t('features.preflight.queue.kept') : t('features.preflight.queue.undone', { n: entries.length }))
  // the cards come back at their old places, the first focused
  const tab = tabNow()
  if (tab) setCurrent(tab, entries[0].id)
  for (const lamp of new Set(entries.map((e) => e.lamp))) await readNow(lamp)
  if (tab) syncTab(tab)
  focusCard()
}

/** Every lamp's cards again (the queue opened, a reading changed). */
export function loadAll(): void {
  for (const src of lampSources()) if (src.queue && queueLamps().includes(src.id)) void loadItems(src.id)
}
