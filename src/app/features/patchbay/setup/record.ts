/**
 * The setup band's state (plan §1.12, §3.7, §6 U3 / U4) — what this device remembers of a profile's setup, and which
 * visit shows the full band:
 *
 *  - the RECORD (IndexedDB `one-patchbay` `<scope>|setup` = SetupState { profileId, recipeId?, closed?, firstWriteAt? },
 *    ids only, per member scope, never synced / exported / backed up, wiped with the device copy): written by a drop and
 *    by "Set up in the Patchbay"; `closed` by × on the strip and "Close setup"; `firstWriteAt` once a lamp that was not
 *    green at the drop turned green (the drop's Undo is over then). Read after the first paint (never at boot): the
 *    status bar's setup cell and the page read it through `useSetupRecord()`.
 *  - the VISIT (this tab, in memory): the profile whose band the page shows in full — set by a drop and by "Set up in
 *    the Patchbay" (openPatchbay({ setup, band: true })); it lasts while the setup's own steps lead away and back (the
 *    way back, setup/return.ts, is set when the page closes) and ends when the page closes any other way, so a reload
 *    or a later visit shows the one-line strip instead of the band.
 *
 * Eager-safe: idb-keyval through cache.ts, the member scope, React's useSyncExternalStore — nothing of the lamps.
 */
import { useSyncExternalStore } from 'react'
import type { SetupState } from '../types'
import { onPatchbayWipe, readCache, setupKey, writeCache, dropCache, inPatchbayScope } from '../cache'
import { patchbayScope } from '../scope'

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const RECIPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/** A stored value as a record (anything else reads as none). Pure. */
export function readSetupValue(v: unknown): SetupState | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (typeof o.profileId !== 'string' || !PROFILE_ID.test(o.profileId)) return null
  const out: SetupState = { profileId: o.profileId }
  if (typeof o.recipeId === 'string' && RECIPE_ID.test(o.recipeId)) out.recipeId = o.recipeId
  if (o.closed === true) out.closed = true
  if (typeof o.firstWriteAt === 'number' && Number.isFinite(o.firstWriteAt) && o.firstWriteAt > 0) out.firstWriteAt = o.firstWriteAt
  return out
}
const isSetup = (v: unknown): v is SetupState => readSetupValue(v) !== null

/* ------------------------------------------------------------------ the record */

interface Held {
  scope: string | null
  rec: SetupState | null
  /** read from IndexedDB for this scope (until then: none, never a guess) */
  loaded: boolean
}

let held: Held = { scope: null, rec: null, loaded: false }
const listeners = new Set<() => void>()
const emit = () => {
  for (const fn of [...listeners]) fn()
}
let loading: Promise<void> | null = null

/** The record of this member scope now (null: none, or not read yet). */
export function setupRecord(): SetupState | null {
  const scope = patchbayScope()
  return held.scope === scope && held.loaded ? held.rec : null
}

/** Read the record of this member scope (once per scope; again after a wipe). */
export function loadSetupRecord(): Promise<void> {
  const scope = patchbayScope()
  if (!scope) return Promise.resolve()
  if (held.scope === scope && held.loaded) return Promise.resolve()
  if (loading) return loading
  loading = readCache(setupKey(scope), isSetup)
    .then((v) => {
      // a write of this tab while it was read wins
      if (held.scope === scope && held.loaded) return
      held = { scope, rec: v ? readSetupValue(v) : null, loaded: true }
      emit()
    })
    .catch(() => {
      held = { scope, rec: null, loaded: true }
      emit()
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** Write (null: drop) the record of this member scope — this tab's copy at once, IndexedDB behind it. */
export function writeSetupRecord(rec: SetupState | null): void {
  const scope = patchbayScope()
  if (!scope) return
  const clean = rec ? readSetupValue(rec) : null
  held = { scope, rec: clean, loaded: true }
  emit()
  if (clean) void writeCache(setupKey(scope), clean)
  else void dropCache(setupKey(scope))
}

/** Change the record of this member scope (nothing when there is none, or it names another profile). */
export function patchSetupRecord(profileId: string, patch: Partial<SetupState>): void {
  const cur = setupRecord()
  if (!cur || cur.profileId !== profileId) return
  writeSetupRecord({ ...cur, ...patch })
}

/* ------------------------------------------------------------------ the visit */

export interface SetupVisit {
  profileId: string
  recipeId?: string
  /** the drop's file name ("tracker-cnsx.integration.json"; none: "Set up in the Patchbay") — this tab only */
  file?: string
  /** when the visit began (a drop: the drop) */
  at: number
}

let visit: SetupVisit | null = null

/** The visit whose band shows in full (null: none — a later visit shows the strip). */
export const setupVisit = (): SetupVisit | null => visit

/**
 * A drop or "Set up in the Patchbay": the band shows in full for this visit, and the record names the profile (open
 * again — × and "Close setup" are undone by this).
 */
export function markSetupVisit(profileId: string, opts: { recipeId?: string; file?: string; fresh?: boolean } = {}): void {
  if (!PROFILE_ID.test(profileId)) return
  const cur = setupRecord()
  // the same profile keeps its recipe tab and when its setup began (a drop starts afresh)
  const keep = !opts.fresh && !!cur && cur.profileId === profileId
  const recipeId = opts.recipeId ?? (keep ? cur!.recipeId : undefined) ?? (visit?.profileId === profileId && !opts.fresh ? visit.recipeId : undefined)
  visit = { profileId, ...(recipeId ? { recipeId } : {}), ...(opts.file ? { file: opts.file } : {}), at: Date.now() }
  writeSetupRecord({ profileId, ...(recipeId ? { recipeId } : {}), ...(keep && cur!.firstWriteAt ? { firstWriteAt: cur!.firstWriteAt } : {}) })
  emit()
}

/** The visit ends (the page closed by a way that is not one of the setup's own steps; the setup closed). */
export function endSetupVisit(): void {
  if (!visit) return
  visit = null
  emit()
}

/** The recipe tab shown (the band's head, ≥ 2 recipes): kept in the visit and the record. */
export function pickRecipe(profileId: string, recipeId: string): void {
  if (!RECIPE_ID.test(recipeId)) return
  if (visit && visit.profileId === profileId) visit = { ...visit, recipeId }
  patchSetupRecord(profileId, { recipeId })
  emit()
}

/* ------------------------------------------------------------------ React */

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
let snap: { rec: SetupState | null; visit: SetupVisit | null; loaded: boolean } = { rec: null, visit: null, loaded: false }
const snapshot = () => {
  const rec = setupRecord()
  const loaded = held.scope === patchbayScope() && held.loaded
  if (rec !== snap.rec || visit !== snap.visit || loaded !== snap.loaded) snap = { rec, visit, loaded }
  return snap
}

/** React: the record of this member scope, the visit, and whether the record was read. */
export const useSetupRecord = (): { rec: SetupState | null; visit: SetupVisit | null; loaded: boolean } => useSyncExternalStore(subscribe, snapshot, snapshot)

/* ------------------------------------------------------------------ wipes */

onPatchbayWipe((scope) => {
  if (held.scope && inPatchbayScope(held.scope, scope)) {
    held = { scope: null, rec: null, loaded: false }
    visit = null
    emit()
  }
})
