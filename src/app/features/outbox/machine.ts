/**
 * The slip's state machine (pure; docs/OUTBOX.md § States). Every writer asks `next(state, event)` and refuses a null:
 * nothing reaches 'sent' from 'ready' except the person's "Mark as sent" (the hand path) — a wire send goes through
 * 'sending' first (write-ahead, slice 2), and a failure after the call left is 'unclear', never 'failed'.
 * CHANGED is a lamp on a ready slip (`lastCheck`), not a state; there is no persisted "drafting" state.
 */
import type { SlipState } from './types'

export type SlipEvent =
  /** the person wrote the missing text (E) */
  | 'write'
  /** H on a ready slip */
  | 'hold'
  /** H again, E or R on a held slip */
  | 'release'
  | 'withdraw'
  /** the press: compare-and-set, before any byte leaves */
  | 'press'
  | 'ok'
  /** initialize / connect / auth / host refused — nothing left One */
  | 'failBefore'
  /** after the call left: timeout, link lost */
  | 'failAfter'
  /** the tool's own error; the read-back says absent / present, or there is no read-back */
  | 'toolErrorAbsent'
  | 'toolErrorPresent'
  | 'toolErrorNoConfirm'
  | 'readMatch'
  | 'readMismatch'
  /** an UNCLEAR slip settled: the ledger / read-back says done, or did not arrive */
  | 'settleArrived'
  | 'settleMissing'
  /** the hand path: the person says it went out */
  | 'markSent'
  /** boot: a 'sending' slip whose lock nobody holds */
  | 'boot'

const T: Partial<Record<SlipState, Partial<Record<SlipEvent, SlipState>>>> = {
  missing: { write: 'ready', withdraw: 'withdrawn' },
  ready: { hold: 'held', withdraw: 'withdrawn', press: 'sending', markSent: 'sent' },
  held: { release: 'ready', withdraw: 'withdrawn' },
  failed: { withdraw: 'withdrawn', press: 'sending' },
  sending: { ok: 'sent', failBefore: 'failed', failAfter: 'unclear', toolErrorAbsent: 'failed', toolErrorPresent: 'sent', toolErrorNoConfirm: 'failed', boot: 'unclear' },
  sent: { readMatch: 'confirmed', readMismatch: 'unconfirmed' },
  unclear: { settleArrived: 'sent', settleMissing: 'ready' },
}

/** The state after an event, or null when the event is not allowed there. */
export function next(state: SlipState, event: SlipEvent): SlipState | null {
  return T[state]?.[event] ?? null
}

/** May the person still change the text / withdraw it (nothing has left One)? */
export const unsent = (s: SlipState): boolean => s === 'missing' || s === 'ready' || s === 'held' || s === 'failed'
