/**
 * THE count of the Outbox (pure): the sidebar, a database's tree row and readout, the dock, #/outbox and the status
 * bar all read `outboxCounts` — so they always agree. Open = missing · ready · held · sending · unclear · failed ·
 * unconfirmed. Of the open ones, a held slip counts as held (whatever it read), the rest as foreign when foreign text
 * shaped it (or an address came only from foreign text), else as clean when its seal is clean and nothing changed.
 */
import type { ID } from '../../store/types'
import { OPEN_STATES, SENT_STATES, type OutboxCounts, type Slip } from './types'

export const isOpen = (s: Pick<Slip, 'state'>) => OPEN_STATES.includes(s.state)

/** CHANGED: a later reading differs from the draft's (and the person did not say "send anyway"). */
export const isChanged = (s: Pick<Slip, 'lastCheck'>) => !!s.lastCheck?.changed.length && !s.lastCheck.ack

/** Foreign text shaped it: a source neither trusted nor typed, or an address only in foreign text. */
export const isForeign = (s: Pick<Slip, 'seal'>) => s.seal.foreign > 0 || s.seal.addresses.some((a) => a.only === 'foreign')

export const isClean = (s: Pick<Slip, 'state' | 'seal' | 'lastCheck'>) => s.state === 'ready' && s.seal.clean && !isChanged(s)

/** Local midnight of `now`. */
export function dayStart(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const sentToday = (s: Pick<Slip, 'state' | 'receipt'>, now = Date.now()) => SENT_STATES.includes(s.state) && !!s.receipt && s.receipt.at >= dayStart(now)

export function outboxCounts(slips: Iterable<Slip>, dbId?: ID | null, now = Date.now()): OutboxCounts {
  const c: OutboxCounts = { open: 0, clean: 0, foreign: 0, held: 0, changed: 0, unclear: 0, missing: 0, sentToday: 0 }
  for (const s of slips) {
    if (dbId && s.target.dbId !== dbId) continue
    if (sentToday(s, now)) c.sentToday++
    if (!isOpen(s)) continue
    c.open++
    if (s.state === 'unclear') c.unclear++
    if (s.state === 'missing') c.missing++
    if (isChanged(s)) c.changed++
    if (s.state === 'held') c.held++
    else if (isForeign(s)) c.foreign++
    else if (isClean(s)) c.clean++
  }
  return c
}
