/**
 * The way back to the setup (plan §1.11, §6 U2): a lamp step that changes the route (02 the test on #/mcp, 03 the
 * profile in Workspace › Integrations, 06 the run's review on #/agents/<id>) leaves the return state — sessionStorage
 * `one.patchbay.return` = { profileId, recipeId?, next } (ids only; per tab, gone with it). While it is set and the
 * route is not #/patchbay the topbar shows the return chip (ui/ReturnChip.tsx, never shed); × clears it. Back on the
 * patchbay — by the chip or any other way, once the route was left — the arrival (setup/arrive.ts) focuses the next
 * lamp's key and says "04 done · 05 next" politely; the state is cleared then.
 *
 * Boot code (the chip is mounted in the topbar on every route): no React beyond useSyncExternalStore, nothing of the
 * lamps — those load with the chip's body and the arrival, lazily. The record is checked on every read and belongs to
 * the member scope it was set in (another workspace never shows it). `next` is the lamp that was worked on when the
 * route was left; the chip shows the lamp that is next now (it reads the lamps while it shows).
 */
import { useSyncExternalStore } from 'react'
import type { ReturnState } from '../types'
import { SS_RETURN } from '../cache'
import { patchbayScope } from '../scope'
import { readReturnValue, type ReturnRecord } from './returnValue'

export type { ReturnRecord }

/* ------------------------------------------------------------------ the record */

const listeners = new Set<() => void>()
let cached: { raw: string | null; scope: string | null; rec: ReturnRecord | null } = { raw: null, scope: null, rec: null }
/** storage refused (a private window, blocked site data): this tab's own copy */
let memory: string | null = null

function rawNow(): string | null {
  try {
    return window.sessionStorage.getItem(SS_RETURN)
  } catch {
    return memory
  }
}

function write(raw: string | null): void {
  memory = raw
  try {
    if (raw === null) window.sessionStorage.removeItem(SS_RETURN)
    else window.sessionStorage.setItem(SS_RETURN, raw)
  } catch {
    /* this tab's own copy holds it */
  }
  for (const fn of listeners) fn()
}

/** The return state of this tab and member scope (null: none). */
export function readReturn(): ReturnRecord | null {
  const raw = rawNow()
  const scope = patchbayScope()
  if (raw === cached.raw && scope === cached.scope) return cached.rec
  cached = { raw, scope, rec: readReturnValue(raw, scope) }
  return cached.rec
}

/** A lamp step leaves the patchbay: remember where the setup was (`next` = the lamp being worked on). */
export function setReturn(state: ReturnState): void {
  const scope = patchbayScope()
  if (!scope) return
  const rec: ReturnRecord = { profileId: state.profileId, ...(state.recipeId ? { recipeId: state.recipeId } : {}), next: state.next, scope, away: false, at: Date.now() }
  write(JSON.stringify(rec))
}

/** The route left #/patchbay (the chip notes it): coming back is an arrival now. */
export function markAway(): void {
  const rec = readReturn()
  if (!rec || rec.away) return
  write(JSON.stringify({ ...rec, away: true }))
}

/** × on the chip, or the arrival: the way back is gone. */
export function clearReturn(): void {
  if (rawNow() === null && memory === null) return
  write(null)
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The return state for React (null: none). */
export const useReturn = (): ReturnRecord | null => useSyncExternalStore(subscribe, readReturn, readReturn)

/* ------------------------------------------------------------------ the arrival's sentence */

let said = ''
const sayListeners = new Set<() => void>()

/** The polite live region's text ("04 done · 05 next") — set by the arrival, read by the chip's host. */
export function sayArrival(text: string): void {
  // the same sentence twice in a row is still read out: cleared first, set a frame later
  said = ''
  for (const fn of sayListeners) fn()
  requestAnimationFrame(() => {
    said = text
    for (const fn of sayListeners) fn()
  })
}

const subscribeSaid = (fn: () => void) => {
  sayListeners.add(fn)
  return () => sayListeners.delete(fn)
}
const saidNow = () => said

/** The arrival's sentence for React. */
export const useArrivalText = (): string => useSyncExternalStore(subscribeSaid, saidNow, saidNow)
