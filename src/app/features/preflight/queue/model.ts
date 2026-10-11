/**
 * The queue's pure core (§7.2, §7.5): the risk order, ANGESTAUBT, the gauge, where focus goes when a card leaves, what
 * ⇧A may take, what Z takes back. No imports beyond types — preflight-engine.spec tests every function here.
 */
import type { HandWhy, LampId, QueueItem } from '../registry'
import type { DoneEntry } from '../types'

/** a card untouched (never opened) this long is ANGESTAUBT */
export const STALE_DAYS = 7
export const DAY_MS = 86_400_000
/** compact rows drawn below the current card (the rest: "+n more") */
export const ROWS_MAX = 200

/** Stale: older than 7 days and never the current card (here or in another tab). */
export function staleOf(item: Pick<QueueItem, 'id' | 'at'>, now: number, opened: (id: string) => boolean): boolean {
  return item.at > 0 && item.at < now - STALE_DAYS * DAY_MS && !opened(item.id)
}

/** A card's risk group: clean 0 · VON HAND 1 · ANGESTAUBT 2. */
export const groupOf = (item: Pick<QueueItem, 'hand' | 'stale'>): number => (item.stale ? 2 : item.hand.length ? 1 : 0)

/**
 * The risk order: clean first, VON HAND next, ANGESTAUBT last; then by lamp, sub-source, time (oldest first), the
 * order inside a batch (parents before children), id. Returns copies with `stale` set.
 */
export function sortItems(items: readonly QueueItem[], lampOrder: (lamp: LampId) => number, now: number, opened: (id: string) => boolean): QueueItem[] {
  const out = items.map((it) => ({ ...it, stale: staleOf(it, now, opened) }))
  const key = (it: QueueItem): Array<number | string> => [groupOf(it), lampOrder(it.lamp), it.sub ?? 0, it.at, it.n ?? 0, it.id]
  return out.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] === kb[i]) continue
      return ka[i] < kb[i] ? -1 : 1
    }
    return 0
  })
}

/**
 * The order a tab shows: the order it had (done and gone ids stay, the gauge counts them) with arrivals at their risk
 * place — right after the nearest card before them in the sorted list that is already shown, else at the front.
 */
export function mergeOrder(prev: readonly string[] | undefined, sorted: readonly string[]): string[] {
  if (!prev?.length) return [...sorted]
  const known = new Set(prev)
  const out = [...prev]
  let anchor: string | null = null
  for (const id of sorted) {
    if (known.has(id)) {
      anchor = id
      continue
    }
    const at = anchor === null ? 0 : out.indexOf(anchor) + 1
    out.splice(at, 0, id)
    known.add(id)
    anchor = id
  }
  return out
}

export type Cell = 'd' | 'c' | 's' | ''

/** The gauge: one cell per card of the tab at open — done (ink), current (signal), stale (hatched), open. */
export function gauge(order: readonly string[], current: string | null, isOpen: (id: string) => boolean, isStale: (id: string) => boolean): Cell[] {
  return order.map((id) => (id === current ? 'c' : !isOpen(id) ? 'd' : isStale(id) ? 's' : ''))
}

/** "3 / 10": the current card's place among the tab's cards at open (done ones included). */
export function position(order: readonly string[], current: string | null): { i: number; n: number } {
  const i = current ? order.indexOf(current) : -1
  return { i: i + 1, n: order.length }
}

/** A card left: focus goes to the next open card after it, else the previous one, else none. */
export function focusAfterLeave(order: readonly string[], leaving: string, isOpen: (id: string) => boolean): string | null {
  const at = order.indexOf(leaving)
  for (let i = at + 1; i < order.length; i++) if (order[i] !== leaving && isOpen(order[i])) return order[i]
  for (let i = (at < 0 ? order.length : at) - 1; i >= 0; i--) if (order[i] !== leaving && isOpen(order[i])) return order[i]
  return null
}

/** J / K: the next / previous open card (tombstones are skipped forward only — they are never gone back to). */
export function step(order: readonly string[], current: string | null, dir: 1 | -1, isOpen: (id: string) => boolean): string | null {
  const at = current ? order.indexOf(current) : -1
  for (let i = at + dir; i >= 0 && i < order.length; i += dir) if (isOpen(order[i])) return order[i]
  return null
}

/**
 * What ⇧A may take of a tab: clean cards (bulk allowed, no VON HAND reason now, not stale, not blocked) — `unseen`:
 * those not shown in full in this tab yet (the bulk sheet shows them first). Never on "All".
 */
export function bulkPlan(
  items: readonly QueueItem[],
  viewed: (id: string) => boolean,
  now: (item: QueueItem) => { hand: HandWhy[]; blocked: boolean } | null,
): { clean: string[]; unseen: string[] } {
  const clean: string[] = []
  for (const it of items) {
    if (!it.bulk || it.stale) continue
    const a = now(it)
    if (!a || a.blocked || a.hand.length || it.hand.length) continue
    clean.push(it.id)
  }
  return { clean, unseen: clean.filter((id) => !viewed(id)) }
}

/**
 * What Z takes back: the newest done entry not undone yet — with every entry of its batch. Never skips to an older one:
 * an entry without Undo comes back as it is (the caller says why).
 */
export function undoTarget(done: readonly DoneEntry[]): DoneEntry[] {
  for (let i = done.length - 1; i >= 0; i--) {
    const e = done[i]
    if (e.undone) continue
    return e.batch ? done.filter((x) => x.batch === e.batch && !x.undone) : [e]
  }
  return []
}

/** ANGESTAUBT: how many, for how many days (min–max), between which runs (oldest – newest `at`). */
export function staleSpan(items: ReadonlyArray<Pick<QueueItem, 'at'>>, now: number): { n: number; minDays: number; maxDays: number; from: number; to: number } | null {
  if (!items.length) return null
  const ats = items.map((i) => i.at)
  const from = Math.min(...ats)
  const to = Math.max(...ats)
  return { n: items.length, minDays: Math.floor((now - to) / DAY_MS), maxDays: Math.floor((now - from) / DAY_MS), from, to }
}
