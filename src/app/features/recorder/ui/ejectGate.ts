/**
 * May this deck eject at all (the plate's key, before anything is planned)? The local workspace only (R3; the store's
 * guard says the same) — light on purpose: the deck's chunk never loads the planner for it.
 */
import { rewindAllowed } from '../../../store/rewind'
import { scopeNow } from '../journal/scope'

export const canEjectHere = (): boolean => scopeNow().startsWith('local:') && rewindAllowed()
