/**
 * Patching in this tab (P4, B16): the Patching switch of this device, plans on the rack as the page holds it, and the
 * Undo of every patch — beside the fuse keys' (keys.ts), the same rules (plan §1.9, §1.13):
 *
 *  - the switch: localStorage `one.patchbay.patch` ('1' = on; off by default — the rack only shows). Per device, never
 *    synced; the local reset drops it with every `one.patchbay.*` key, a removed team copy keeps it (a device switch).
 *  - planOn(patch) → patch.ts plan() on the workspace as it is now, with the model the page holds (state.ts — the memo's
 *    input: nothing built twice);
 *  - commitOn(patch, plan, names) → patchApply.ts commitPatch (`you~patchbay`; the targets read again first — one changed
 *    since the plan refuses "changed since"); a written patch joins this tab session's stack (≤ 20, newest last);
 *  - undoOn(id?) → the newest patch not taken back (or `id`) through patchApply.ts undoPatch (`you~undo`: refused when a
 *    target changed since — config fields only — or a locked database forbids putting it back).
 * The stack lives in memory for this tab session: the toast's Undo works from any route, Mod+Z only on #/patchbay.
 */
import { create } from 'zustand'
import { LS_PATCH, lsGet, lsSet } from './cache'
import { commitPatch, planPatch, undoPatch } from './patchApply'
import { refreshModel, usePatchbay } from './state'
import type { MsgRef, OpenTarget, Patch, PatchPlan, PatchWrite } from './types'

const P = 'features.patchbay'
/** Patches kept per tab session (§1.9: the same as the keys'). */
export const PATCH_UNDO_MAX = 20

/* ------------------------------------------------------------------ the switch */

export const usePatchSwitch = create<{ on: boolean }>(() => ({ on: lsGet(LS_PATCH) === '1' }))

/** Switch patching on / off on this device (remembered: localStorage `one.patchbay.patch`). */
export function setPatching(on: boolean): void {
  lsSet(LS_PATCH, on ? '1' : null)
  usePatchSwitch.setState({ on })
}

/* ------------------------------------------------------------------ plans */

export type PlanOk = Extract<PatchPlan, { writes: PatchWrite[] }>
export type PlanNo = Extract<PatchPlan, { refused: MsgRef }>
export const planRefused = (p: PatchPlan): p is PlanNo => 'refused' in p

/** Plan a patch on the workspace now, with the model the page holds (the memo's input — never built twice). */
export function planOn(patch: Patch): PatchPlan {
  const model = refreshModel()
  const input = usePatchbay.getState().input ?? undefined
  return planPatch(patch, input ? { input, model } : {})
}

/* ------------------------------------------------------------------ the stack */

/** The words a patch was made with (its toast and its Undo name them as they were). */
export interface PatchNames {
  from: string
  to: string
  /** lock / unlock: the tool and the profile's name */
  tool?: string
}

export interface PatchDone {
  id: string
  at: number
  patch: Patch
  writes: PatchWrite[]
  inverse: PatchWrite[]
  names: PatchNames
  /** said with the write ("<creator> must confirm the agent afterwards", "server removed from the agent") */
  notes: MsgRef[]
  /** the fuses it opened (their labels then) */
  opens: string[]
  /** taken back (the toast, Mod+Z) */
  undone?: true
}

export const usePatchStack = create<{ done: PatchDone[] }>(() => ({ done: [] }))

let seq = 0
const nextId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

/** Write a plan as the person in the Patchbay (`you~patchbay`) — on the stack once written. */
export function commitOn(patch: Patch, plan: PlanOk, names: PatchNames): { ok: true; done: PatchDone } | { ok: false; refused: MsgRef } {
  const r = commitPatch(plan)
  if (!r.ok) return r
  const done: PatchDone = { id: nextId(), at: Date.now(), patch, writes: plan.writes, inverse: plan.inverse, names, notes: plan.notes ?? [], opens: (plan.opens ?? []).map((o) => o.label) }
  usePatchStack.setState({ done: [...usePatchStack.getState().done, done].slice(-PATCH_UNDO_MAX) })
  return { ok: true, done }
}

/** Take a patch back (`id`; none: the newest not taken back yet) as `you~undo`. */
export function undoOn(id?: string): { ok: true; done: PatchDone } | { ok: false; refused: MsgRef; open?: OpenTarget; done?: PatchDone } {
  const list = usePatchStack.getState().done
  const done = id ? list.find((d) => d.id === id) : [...list].reverse().find((d) => !d.undone)
  if (!done) return { ok: false, refused: { key: `${P}.keys.nothing` } }
  if (done.undone) return { ok: false, refused: { key: `${P}.patch.undoneAlready` }, done }
  const r = undoPatch({ writes: done.writes, inverse: done.inverse })
  if (!r.ok) return { ok: false, refused: r.refused, done, ...(openOf(done) ? { open: openOf(done)! } : {}) }
  usePatchStack.setState({ done: usePatchStack.getState().done.map((d) => (d.id === done.id ? { ...d, undone: true as const } : d)) })
  return { ok: true, done: { ...done, undone: true } }
}

/** Where a refused Undo sends the person: the agent's editor, the database's automations / commands, the profile. */
function openOf(d: PatchDone): OpenTarget | null {
  const w = d.inverse[0]
  if (!w) return null
  if (w.w === 'agent') return { to: 'route', route: { name: 'agents', id: w.agent.id } }
  if (w.w === 'automations') return { to: 'modal', modal: 'automations', databaseId: w.db }
  if (w.w === 'commands') return { to: 'modal', modal: 'dbCommands', databaseId: w.db }
  // Orders B10: the work orders' settings live on their database
  if (w.w === 'orders') return { to: 'route', route: { name: 'page', id: w.db } }
  return { to: 'route', route: { name: 'workspace', section: 'integrations' } }
}

/** The newest patch this tab session can still take back (null: none). */
export function lastPatch(): PatchDone | null {
  return [...usePatchStack.getState().done].reverse().find((d) => !d.undone) ?? null
}

/* ------------------------------------------------------------------ seam */

const seamOn = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

if (seamOn && typeof window !== 'undefined') {
  ;(window as unknown as { __onePatchbayPatches?: unknown }).__onePatchbayPatches = {
    stack: () => usePatchStack.getState().done.map((d) => ({ id: d.id, op: d.patch.op, from: d.patch.from.module, to: d.patch.to.module, undone: !!d.undone })),
    plan: (patch: Patch) => {
      const p = planOn(patch)
      return planRefused(p) ? { refused: p.refused, ...(p.info ? { info: true } : {}) } : { asks: p.asks ?? [], notes: p.notes ?? [], opens: p.opens ?? [], writes: p.writes.map((w) => w.w) }
    },
  }
}
