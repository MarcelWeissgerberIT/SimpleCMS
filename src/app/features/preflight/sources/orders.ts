/**
 * Lamp "Prüfaufträge" / "Work orders" (spec §5 of the work orders, B9) — what a work order's chain waits for on this
 * device, read from the orders' own reading (coding orderCards: this device's records, the engine's moves, the request
 * rows — O(requests), never a page-map walk). Ids `order:<row>:<kind>…`; kinds:
 *   ready        Kette bereit — A ↵ Kette starten (exactly the plan the card rendered: its hash; seen in full first, the
 *                plate's book) · D Verwerfen · O open
 *   next         Weiter mit Schritt n? — A ↵ Weiter / Bestätigen und weiter (passes exactly what the card showed) ·
 *                R Ab hier neu planen (after an analysis) · D Anhalten · O open
 *   halted       Kette angehalten — A ↵ Fortsetzen (only where the chain advances; refused at its budget) · 1 Schritt
 *                überspringen · O open
 *   interrupted  Unterbrochen — A Rest anlegen · D Angelegte verwerfen (both VON HAND) · O open
 *   chainConfirm Kette bestätigen — A ↵ confirms exactly the versions shown, all or nothing · O open
 *   request      Auf anderem Gerät angefordert (a team) — A ↵ Hier planen (a planner request) · O open
 * Every key that lets the worker start something is VON HAND ('startsNow' + 'claudeCode'), every card is out of ⇧A
 * and X (`bulk: false`); each key calls the orders' own entry point through queue/calls.ts and reports what really
 * happened. A card whose subject moved on since it was read ("changed") is read again (the card's "Read again").
 */
import { useWorkspace } from '../../../store/store'
import { navigate } from '../../../lib/router'
import { t } from '../../../i18n'
import {
  OrderCardBody,
  chainKeyBlock,
  dropOrderPrep,
  onOrderCardsChanged,
  onOrderSeen,
  orderCards,
  orderCode,
  orderDbIds,
  orderPrep,
  orderPreWhyText,
  orderStartRefusalText,
  parseOrderCard,
  prepareOrderCard,
  readyBlock,
  nextBlock,
  type OrderCard,
  type OrderCardKind,
} from '../../coding'
import type { CardAction, Done, HandWhy, LampReading, LampSourceDef, QueueItem } from '../registry'
import {
  advanceOrderChain,
  confirmOrderChain,
  discardOrderMade,
  discardOrderPlan,
  finishOrderRest,
  haltOrderChain,
  planOrderHere,
  replanOrderFrom,
  resumeOrderChain,
  skipOrderStep,
  startOrderChain,
  undoOrderChain,
} from '../queue/calls'
import { all } from './util'
import { titleOf } from './proposals/common'

const O = 'features.coding.order'
const P = 'features.coding.order.pf'
const CHANGED = 'features.preflight.err.changed'
const LOADING = { key: 'features.preflight.why.loading' }
/** a key that lets the worker start something */
const STARTS: HandWhy[] = ['startsNow', 'claudeCode']
const KINDS: Record<OrderCardKind, number> = { ready: 0, next: 1, halted: 2, interrupted: 3, chainConfirm: 4, request: 5 }

/** What the chain guard says, as a card's blocked reason (null: may act). */
function guard(): CardAction['blocked'] {
  const why = chainKeyBlock()
  return why ? { key: `${O}.keyWhy.${why}` } : null
}

/** A refused chain key, as the card's error: "changed / moved on" reads the card again, the rest in words. */
function refused(id: string, why: string): Done {
  if (why === 'changed' || why === 'state') {
    dropOrderPrep(id)
    return { ok: false, error: CHANGED }
  }
  return { ok: false, error: t(`${O}.keyWhy.${why}`) }
}

const open = (row: string): CardAction => ({ key: 'o', label: t(`${P}.key.open`), outcome: 'hand', run: () => (navigate({ name: 'page', id: row }), { ok: true, stay: true }) })

/** The detail line of a card (what it is about, in the queue's compact row). */
function detailOf(c: OrderCard): string {
  switch (c.kind) {
    case 'next':
      return t(`${O}.preflight.next`, { n: String(c.step ?? 0).padStart(2, '0') })
    default:
      return t(`${O}.preflight.${c.kind}`)
  }
}

function itemOf(c: OrderCard): QueueItem {
  const s = useWorkspace.getState()
  const row = s.pages[c.row]
  return {
    id: c.id,
    lamp: 'orders',
    kind: c.kind,
    // the source: the work orders' database
    tag: titleOf(row?.databaseId) || t('features.preflight.lamp.orders.short'),
    refs: { pageId: c.row, ...(row?.databaseId ? { dbId: row.databaseId } : {}) },
    at: c.at,
    hand: c.kind === 'request' ? ['tokens'] : STARTS,
    bulk: false,
    title: titleOf(c.row) || t('common.untitled'),
    ...(orderCode(c.row) ? { keyText: orderCode(c.row)! } : {}),
    detail: detailOf(c),
    sub: KINDS[c.kind],
  }
}

/* ---------------- the keys, per kind */

function readyKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  // a server took part in the plan: the key says so ("· mit Server-Inhalt")
  const foreign = prep?.kind === 'ready' && prep.server
  return [
    {
      key: 'a',
      label: t(foreign ? `${O}.key.startForeign` : `${O}.key.start`),
      outcome: 'hand',
      hand: STARTS,
      writes: true,
      undoable: true,
      blocked: readyBlock(item.id),
      run: async () => {
        const p = orderPrep(item.id)
        if (p?.kind !== 'ready' || !p.hash) return { ok: false, error: CHANGED }
        const out = await startOrderChain(row, p.hash)
        if (!out.ok) {
          if (out.why === 'changed') {
            dropOrderPrep(item.id)
            return { ok: false, error: CHANGED }
          }
          if (out.why === 'state') return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
          return { ok: false, error: orderStartRefusalText(out) }
        }
        // Z: the chain back as a whole (all or nothing — refused once a step was taken)
        return { ok: true, undo: async () => ((await undoOrderChain(row)).ok ? 'undone' : 'final') }
      },
    },
    {
      key: 'd',
      label: t(`${O}.key.discard`),
      outcome: 'discarded',
      writes: true,
      undoable: true,
      blocked: prep ? null : LOADING,
      run: async () => {
        const out = await discardOrderPlan(row)
        if (!out.ok) return { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true }
        const undo = out.undo
        return undo ? { ok: true, undo: async () => (await undo(), 'undone') } : { ok: true, final: `${P}.final.discard` }
      },
    },
    open(row),
  ]
}

function nextKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  const p = prep?.kind === 'next' ? prep : null
  // Fix 3: the plate's rule — the step as it will run, its Grundlage and every changed page read to their end first
  const blocked: CardAction['blocked'] = !prep ? LOADING : !p ? { key: CHANGED } : (guard() ?? (p.confirm && !p.next.view ? { key: CHANGED } : nextBlock(item.id)))
  const keys: CardAction[] = [
    {
      key: 'a',
      label: t(p?.confirm ? `${O}.key.confirmGo` : `${O}.key.next`),
      outcome: 'hand',
      hand: p?.confirm ? ['confirm', ...STARTS] : STARTS,
      writes: true,
      blocked,
      run: async () => {
        const now = orderPrep(item.id)
        if (now?.kind !== 'next') return { ok: false, error: CHANGED }
        const seen = { refs: Object.fromEntries(now.refs.map((r) => [r.id, r.fp])), ...(now.basisFp ? { basis: now.basisFp } : {}) }
        const out = await advanceOrderChain(row, now.move.step, now.passes, seen, now.confirm ? now.next.view?.hash : undefined)
        if (!out.ok) return refused(item.id, out.why)
        // the same card again (what it showed moved on meanwhile — a page, the Grundlage): read it again
        const again = out.move
        if (again?.kind === 'card' && again.step === now.move.step && [...again.all].sort().join() === [...now.move.all].sort().join()) {
          dropOrderPrep(item.id)
          return { ok: false, error: CHANGED }
        }
        return { ok: true, final: `${P}.final.go` }
      },
    },
  ]
  if (p?.move.all.includes('checkpoint'))
    keys.push({
      key: 'r',
      label: t(`${O}.key.replanHere`),
      outcome: 'command',
      hand: ['tokens'],
      writes: true,
      blocked: guard(),
      run: async () => {
        const out = await replanOrderFrom(row, p.move.from ?? p.move.step - 1)
        return out.ok ? { ok: true, final: `${P}.final.replan` } : refused(item.id, out.why)
      },
    })
  keys.push({
    key: 'd',
    label: t(`${O}.key.halt`),
    outcome: 'command',
    writes: true,
    run: async () => {
      const out = await haltOrderChain(row)
      return out.ok ? { ok: true, final: `${P}.final.halt` } : refused(item.id, out.why)
    },
  })
  keys.push(open(row))
  return keys
}

function haltedKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  const p = prep?.kind === 'halted' ? prep : null
  const blocked: CardAction['blocked'] = !prep ? LOADING : !p ? { key: CHANGED } : (guard() ?? (p.resume === 'budget' ? { key: `${O}.keyWhy.budget` } : null))
  const keys: CardAction[] = [
    {
      key: 'a',
      label: t(`${O}.key.resume`),
      outcome: 'hand',
      hand: STARTS,
      writes: true,
      blocked,
      run: async () => {
        const out = await resumeOrderChain(row)
        return out.ok ? { ok: true, final: `${P}.final.go` } : refused(item.id, out.why)
      },
    },
  ]
  const n = p?.skippable[0]
  if (n !== undefined)
    keys.push({
      key: '1',
      label: t(`${O}.key.skip`, { n: String(n).padStart(2, '0') }),
      outcome: 'hand',
      hand: STARTS,
      writes: true,
      blocked: guard(),
      run: async () => {
        const out = await skipOrderStep(row, n)
        return out.ok ? { ok: true, final: `${P}.final.go` } : refused(item.id, out.why)
      },
    })
  keys.push(open(row))
  return keys
}

function interruptedKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  const p = prep?.kind === 'interrupted' ? prep : null
  const finishBlocked: CardAction['blocked'] = !prep ? LOADING : !p ? { key: CHANGED } : (guard() ?? (p.pre.ok ? null : { key: orderPreWhyText(p.pre.why, p.pre.left) }))
  return [
    {
      key: 'a',
      label: t(`${O}.key.finishRest`),
      outcome: 'hand',
      hand: STARTS,
      writes: true,
      blocked: finishBlocked,
      run: async () => {
        const out = await finishOrderRest(row)
        if (out.ok) return { ok: true, final: `${P}.final.go` }
        if (out.why === 'state') return refused(item.id, 'state')
        return { ok: false, error: orderStartRefusalText(out) }
      },
    },
    {
      key: 'd',
      label: t(`${O}.key.discardMade`),
      outcome: 'discarded',
      hand: ['noBulk'],
      writes: true,
      blocked: !prep ? LOADING : null,
      run: async () => {
        const out = await discardOrderMade(row)
        if (out.ok) return { ok: true, final: `${P}.final.discardMade` }
        if (out.why === 'state') return refused(item.id, 'state')
        return { ok: false, error: orderStartRefusalText(out) }
      },
    },
    open(row),
  ]
}

function confirmKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  const p = prep?.kind === 'chainConfirm' ? prep : null
  const blocked: CardAction['blocked'] = !prep ? LOADING : !p || p.steps.some((s) => !s.view) ? { key: CHANGED } : (guard() ?? (p.problem ? { key: `${P}.confirm.${p.problem}` } : null))
  return [
    {
      key: 'a',
      label: t(`${P}.key.confirmChain`),
      outcome: 'hand',
      hand: ['confirm', ...STARTS],
      writes: true,
      blocked,
      run: async () => {
        const now = orderPrep(item.id)
        if (now?.kind !== 'chainConfirm' || now.steps.some((s) => !s.view)) return { ok: false, error: CHANGED }
        const out = await confirmOrderChain(
          row,
          now.steps.map((s) => ({ id: s.carrier.id, hash: s.view!.hash })),
        )
        if (out.ok) return { ok: true, final: `${P}.final.confirm` }
        if (out.why === 'numbers' || out.why === 'busy' || out.why === 'record') return { ok: false, error: t(out.why === 'numbers' ? `${P}.confirm.numbers` : `${O}.start.why.${out.why}`) }
        return refused(item.id, out.why)
      },
    },
    open(row),
  ]
}

function requestKeys(item: QueueItem, row: string): CardAction[] {
  const prep = orderPrep(item.id)
  const p = prep?.kind === 'request' ? prep : null
  const blocked: CardAction['blocked'] = !prep ? LOADING : !p ? { key: CHANGED } : (guard() ?? (!p.pre.ok && !p.pre.want ? { key: orderPreWhyText(p.pre.why, p.pre.left) } : null))
  return [
    {
      key: 'a',
      label: t(`${P}.key.planHere`),
      outcome: 'hand',
      hand: ['tokens'],
      writes: true,
      blocked,
      run: async () => {
        const out = await planOrderHere(row)
        if (out.kind === 'refused') return out.why === 'gone' ? { ok: false, error: 'features.preflight.err.elsewhere', elsewhere: true } : { ok: false, error: orderPreWhyText(out.why, out.left) }
        // the worker link went away meanwhile: this device only asked for it — nothing planned here
        if (out.kind === 'asked') return { ok: false, error: orderPreWhyText('elsewhere') }
        return { ok: true, final: `${P}.final.replan` }
      },
    },
    open(row),
  ]
}

/* ---------------- the lamp */

let last: OrderCard[] = []

export const ordersLamp: LampSourceDef = {
  id: 'orders',
  order: 35,
  legend: () => t('features.preflight.lamp.orders.legend'),
  short: () => t('features.preflight.lamp.orders.short'),
  rule: () => t('features.preflight.lamp.orders.rule'),
  thresholds: { amber: 1, red: null },
  fitted: () => orderDbIds().length > 0,
  subscribe: (changed) => all(onOrderCardsChanged(changed)),
  read(): LampReading {
    const cards = orderCards()
    last = cards
    const parts: Record<string, number> = {}
    for (const c of cards) parts[c.kind] = (parts[c.kind] ?? 0) + 1
    return { state: 'ok', count: cards.length, ids: cards.map((c) => c.id), second: t('features.preflight.lamp.orders.second'), parts }
  },
  // a Läuft request without a chain here counts only once its Status settled (lamp.ts): looked at again each minute
  tick: true,
  open() {
    const first = last[0]
    if (first) navigate({ name: 'page', id: first.row })
    else navigate({ name: 'coding' })
  },
  queue: {
    items: () => orderCards().map(itemOf),
    prepare: (item) => prepareOrderCard(item.id),
    actions(item) {
      const p = parseOrderCard(item.id)
      if (!p) return []
      switch (p.kind) {
        case 'ready':
          return readyKeys(item, p.row)
        case 'next':
          return nextKeys(item, p.row)
        case 'halted':
          return haltedKeys(item, p.row)
        case 'interrupted':
          return interruptedKeys(item, p.row)
        case 'chainConfirm':
          return confirmKeys(item, p.row)
        case 'request':
          return requestKeys(item, p.row)
      }
    },
    // the ready / next cards' ↵ waits until what they show was seen in full (on the card or the plate): their keys follow
    watch: (_item, changed) => all(onOrderSeen(changed), onOrderCardsChanged(changed)),
    Body: OrderCardBody,
  },
}
